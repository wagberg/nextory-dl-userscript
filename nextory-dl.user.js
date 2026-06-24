// ==UserScript==
// @name         Nextory EPUB Downloader
// @namespace    https://github.com/ballaballaballa/nextory-dl-userscript
// @version      1.0.0
// @description  Download EPUB books from Nextory
// @match        https://www.nextory.com/*/book/*
// @match        https://nextory.com/*/book/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @connect      api.nextory.com
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // --- Config ---
  const APP_ID = '200';
  const APP_VERSION = '2026.01.3';
  const DEVICE_ID = '532cbd7f-d290-3bb0-b3a0-98c004062ccc'; // uuid3(NAMESPACE_DNS, "grawlix")

  // --- State ---
  let authHeaders = null;
  let downloading = false;

  // --- UI ---

  function detectFormats() {
    // Use actual Nextory page structure
    const hasEbook = !!document.querySelector('[data-test="tabs-tab-ebook"]')
      || !!document.querySelector('article[is-ebook="true"]');
    const hasAudiobook = !!document.querySelector('[data-test="tabs-tab-audiobook"]')
      || !!document.querySelector('article[is-audio-book="true"]');
    return { hasEbook, hasAudiobook };
  }

  function injectUI() {
    const container = document.createElement('div');
    container.id = 'nextory-dl-container';
    container.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    `;

    const status = document.createElement('div');
    status.id = 'nextory-dl-status';
    status.style.cssText = `
      padding: 8px 14px; background: rgba(0,0,0,0.85); color: #eee;
      border-radius: 4px; font-size: 12px; max-width: 300px;
      display: none; font-family: monospace;
    `;

    const { hasEbook, hasAudiobook } = detectFormats();

    const btnStyle = `
      padding: 12px 20px; color: white; border: none; border-radius: 6px;
      font-size: 14px; font-weight: bold; cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;

    if (hasEbook) {
      const btn = document.createElement('button');
      btn.id = 'nextory-dl-btn';
      btn.textContent = 'Download EPUB';
      btn.style.cssText = btnStyle + 'background: #e91e63;';
      btn.addEventListener('click', onDownloadClick);
      container.appendChild(btn);
    }

    if (hasAudiobook) {
      const btn = document.createElement('button');
      btn.id = 'nextory-dl-audio-btn';
      btn.textContent = 'Download Audiobook';
      btn.style.cssText = btnStyle + 'background: #666; cursor: not-allowed; opacity: 0.7;';
      btn.title = 'Coming soon';
      btn.disabled = true;
      container.appendChild(btn);
    }

    if (!hasEbook && !hasAudiobook) {
      // Fallback: show epub button anyway (detection might fail)
      const btn = document.createElement('button');
      btn.id = 'nextory-dl-btn';
      btn.textContent = 'Download EPUB';
      btn.style.cssText = btnStyle + 'background: #e91e63;';
      btn.addEventListener('click', onDownloadClick);
      container.appendChild(btn);
    }

    container.appendChild(status);
    document.body.appendChild(container);
  }

  function setStatus(msg) {
    const el = document.getElementById('nextory-dl-status');
    if (el) {
      el.style.display = msg ? 'block' : 'none';
      el.textContent = msg;
    }
    console.log('[Nextory DL]', msg);
  }

  function setButtonEnabled(enabled) {
    const btn = document.getElementById('nextory-dl-btn');
    if (btn) {
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? '1' : '0.5';
      btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }
  }

  // --- Credentials ---

  async function getCredentials() {
    let username = await GM_getValue('nextory_username', null);
    let password = await GM_getValue('nextory_password', null);
    if (username && password) return { username, password };

    username = prompt('Nextory username (email):');
    if (!username) return null;
    password = prompt('Nextory password:');
    if (!password) return null;

    await GM_setValue('nextory_username', username);
    await GM_setValue('nextory_password', password);
    return { username, password };
  }

  async function clearCredentials() {
    await GM_deleteValue('nextory_username');
    await GM_deleteValue('nextory_password');
  }

  // --- HTTP Helper ---

  function gmFetch(method, url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: opts.headers || {},
        data: opts.body || undefined,
        responseType: opts.responseType || 'json',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.response);
          } else {
            reject(new Error(`HTTP ${res.status}: ${url}`));
          }
        },
        onerror: (err) => reject(new Error(`Network error: ${url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${url}`)),
      });
    });
  }

  function gmFetchBinary(url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        responseType: 'arraybuffer',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.response);
          } else {
            reject(new Error(`HTTP ${res.status}: ${url}`));
          }
        },
        onerror: () => reject(new Error(`Network error: ${url}`)),
        ontimeout: () => reject(new Error(`Timeout: ${url}`)),
      });
    });
  }

  // --- Auth ---

  async function authenticate(username, password) {
    const baseHeaders = {
      'Content-Type': 'application/json',
      'X-Application-Id': APP_ID,
      'X-App-Version': APP_VERSION,
      'X-Locale': 'en_GB',
      'X-Country-Code': 'GB',
      'X-Model': 'Personal Computer',
      'X-Device-Id': DEVICE_ID,
      'X-Os-Info': 'Personal Computer',
    };

    // Step 1: Session
    const sessionData = await gmFetch('POST', 'https://api.nextory.com/user/v1/sessions', {
      headers: baseHeaders,
      body: JSON.stringify({ identifier: username, password }),
    });

    if (!sessionData.login_token) throw new Error('No login_token in session response');

    const loginToken = sessionData.login_token;
    const country = sessionData.country || 'GB';

    const authedHeaders = {
      ...baseHeaders,
      'token': loginToken,
      'X-Login-Token': loginToken,
      'X-Country-Code': country,
    };

    // Step 2: Profiles
    const profilesData = await gmFetch('GET', 'https://api.nextory.com/user/v1/me/profiles', {
      headers: authedHeaders,
    });

    if (!profilesData.profiles || !profilesData.profiles.length) {
      throw new Error('No profiles found');
    }

    const loginKey = profilesData.profiles[0].login_key;
    if (!loginKey) throw new Error('No login_key in profile');

    // Step 3: Authorize
    const authorizeData = await gmFetch('POST', 'https://api.nextory.com/user/v1/profile/authorize', {
      headers: authedHeaders,
      body: JSON.stringify({ login_key: loginKey }),
    });

    if (!authorizeData.profile_token) throw new Error('No profile_token in auth response');

    authHeaders = {
      ...authedHeaders,
      'X-Profile-Token': authorizeData.profile_token,
    };
  }

  // --- Book Info ---

  function extractBookId(url) {
    return url.split('-').pop().replace(/\//g, '');
  }

  async function getProductData(bookId) {
    return gmFetch('GET', `https://api.nextory.com/library/v1/products/${bookId}`, {
      headers: authHeaders,
    });
  }

  function findEpubFormat(productData) {
    for (const fmt of productData.formats || []) {
      if (fmt.type === 'epub') return fmt.identifier;
    }
    for (const fmt of productData.formats || []) {
      if (fmt.type === 'pdf') return fmt.identifier;
    }
    throw new Error('No epub/pdf format found for this book');
  }

  async function getEpubPackage(epubId) {
    return gmFetch('GET', `https://api.nextory.com/reader/books/${epubId}/packages/epub`, {
      headers: authHeaders,
    });
  }

  // --- Decryption ---

  function fixKey(value) {
    // Strip last character, then base64-decode
    const b64 = value.slice(0, -1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function decryptData(encrypted, keyBytes, ivBytes) {
    // Web Crypto AES-CBC always expects PKCS7 padding, but Nextory uses no padding.
    // Workaround: encrypt a padding-only block (16 bytes of 0x10) using the last
    // ciphertext block as IV, append it, then decrypt. Web Crypto will strip
    // the padding block and return the original plaintext.
    const blockSize = 16;
    const encBytes = new Uint8Array(encrypted);
    const lastBlock = encBytes.slice(-blockSize);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']
    );

    // Create a valid final block: encrypt 16 bytes of 0x10 (PKCS7 full padding block)
    const paddingBlock = new Uint8Array(blockSize).fill(blockSize);
    const encryptedPadding = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: lastBlock }, cryptoKey, paddingBlock
    );
    // encrypt() adds its own padding, giving 32 bytes. We only need the first 16.
    const fakeCipherBlock = new Uint8Array(encryptedPadding).slice(0, blockSize);

    // Append fake block to ciphertext
    const combined = new Uint8Array(encBytes.length + blockSize);
    combined.set(encBytes, 0);
    combined.set(fakeCipherBlock, encBytes.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBytes }, cryptoKey, combined
    );
    return new Uint8Array(decrypted);
  }

  // --- EPUB Merging ---

  function isMetadataFile(filename) {
    return (
      filename.endsWith('.opf') ||
      filename.endsWith('.ncx') ||
      filename.startsWith('META-INF/') ||
      filename === 'mimetype' ||
      filename.endsWith('.toc')
    );
  }

  function isHtmlFile(filename) {
    return filename.endsWith('.html') || filename.endsWith('.xhtml') || filename.endsWith('.htm');
  }

  function isAuxiliaryFile(filename) {
    const base = filename.split('/').pop().toLowerCase();
    const aux = ['cover.html', 'cover.xhtml', 'title.html', 'titlepage.html',
      'copyright.html', 'legal.html', 'nav.html', 'toc.html', 'toc.xhtml',
      'about.html', 'colophon.html'];
    return aux.includes(base);
  }

  async function mergeFragments(decryptedFragments, tocData) {
    // Build TOC ordering
    const tocOrder = new Map();
    if (tocData && tocData.childrens) {
      tocData.childrens.forEach((item, idx) => {
        const filename = item.src.split('#')[0];
        tocOrder.set(filename, { index: idx, title: item.name });
      });
    }

    const htmlContentMap = new Map(); // filepath -> Uint8Array
    const assetMap = new Map(); // filepath -> Uint8Array

    for (let i = 0; i < decryptedFragments.length; i++) {
      setStatus(`Merging EPUB... (${i + 1}/${decryptedFragments.length})`);
      try {
        // Use fflate's synchronous unzip - no promises, no timers
        const files = fflate.unzipSync(decryptedFragments[i]);

        for (const [filepath, content] of Object.entries(files)) {
          if (content.length === 0 || isMetadataFile(filepath)) continue;

          if (isHtmlFile(filepath)) {
            if (!htmlContentMap.has(filepath) || content.length > htmlContentMap.get(filepath).length) {
              htmlContentMap.set(filepath, content);
            }
          } else {
            if (!assetMap.has(filepath)) {
              assetMap.set(filepath, content);
            }
          }
        }
      } catch (e) {
        console.warn(`[Nextory DL] Failed to parse fragment ${i + 1}:`, e.message);
      }
    }

    return { htmlContentMap, assetMap, tocOrder };
  }

  // --- EPUB Assembly ---

  function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getMimeType(filepath) {
    const ext = filepath.split('.').pop().toLowerCase();
    const types = {
      html: 'application/xhtml+xml', xhtml: 'application/xhtml+xml', htm: 'application/xhtml+xml',
      css: 'text/css', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf',
      woff: 'application/font-woff', woff2: 'font/woff2', ncx: 'application/x-dtbncx+xml',
    };
    return types[ext] || 'application/octet-stream';
  }

  function buildEpub(htmlContentMap, assetMap, tocOrder, metadata) {
    const enc = new TextEncoder();

    // Sort HTML files by TOC order
    const htmlEntries = [];
    for (const [filepath, content] of htmlContentMap) {
      const basename = filepath.split('/').pop();
      const toc = tocOrder.get(basename);
      htmlEntries.push({
        filepath,
        content,
        order: toc ? toc.index : Infinity,
        title: toc ? toc.title : null,
        inToc: !!toc,
      });
    }
    htmlEntries.sort((a, b) => a.order - b.order);

    // Build manifest items
    let manifestItems = '';
    let spineItems = '';
    let navPoints = '';
    let navIdx = 1;

    for (const entry of htmlEntries) {
      const id = `item_${entry.filepath.replace(/[^a-z0-9]/gi, '_')}`;
      manifestItems += `    <item id="${id}" href="${escapeXml(entry.filepath)}" media-type="application/xhtml+xml"/>\n`;
      if (entry.inToc || !isAuxiliaryFile(entry.filepath)) {
        spineItems += `    <itemref idref="${id}"/>\n`;
      }
      if (entry.inToc && entry.title) {
        navPoints += `    <navPoint id="nav_${navIdx}" playOrder="${navIdx}">
      <navLabel><text>${escapeXml(entry.title)}</text></navLabel>
      <content src="${escapeXml(entry.filepath)}"/>
    </navPoint>\n`;
        navIdx++;
      }
    }

    for (const [filepath] of assetMap) {
      const id = `asset_${filepath.replace(/[^a-z0-9]/gi, '_')}`;
      manifestItems += `    <item id="${id}" href="${escapeXml(filepath)}" media-type="${getMimeType(filepath)}"/>\n`;
    }

    manifestItems += `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n`;

    const title = metadata.title || 'Unknown';
    const authors = (metadata.authors || []).map(a => a.name || a).join(', ');
    const language = metadata.language || 'en';
    const isbn = metadata.isbn || '';

    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator opf:role="aut">${escapeXml(authors)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <dc:identifier id="BookId">${escapeXml(isbn)}</dc:identifier>
  </metadata>
  <manifest>
${manifestItems}  </manifest>
  <spine toc="ncx">
${spineItems}  </spine>
</package>`;

    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(isbn)}"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}  </navMap>
</ncx>`;

    // Build zip using fflate
    const zipData = {};
    zipData['mimetype'] = [enc.encode('application/epub+zip'), { level: 0 }];
    zipData['META-INF/container.xml'] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
    zipData['OEBPS/content.opf'] = enc.encode(contentOpf);
    zipData['OEBPS/toc.ncx'] = enc.encode(tocNcx);

    for (const entry of htmlEntries) {
      zipData[`OEBPS/${entry.filepath}`] = entry.content;
    }
    for (const [filepath, content] of assetMap) {
      const ext = filepath.split('.').pop().toLowerCase();
      const noCompress = ['jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4', 'otf', 'ttf', 'woff', 'woff2'];
      zipData[`OEBPS/${filepath}`] = noCompress.includes(ext) ? [content, { level: 0 }] : content;
    }

    const zipped = fflate.zipSync(zipData, { level: 6 });
    return new Blob([zipped], { type: 'application/epub+zip' });
  }

  // --- File Save ---

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // --- Main Flow ---

  async function onDownloadClick() {
    if (downloading) return;
    downloading = true;
    setButtonEnabled(false);

    try {
      // Credentials
      setStatus('Getting credentials...');
      const creds = await getCredentials();
      if (!creds) { setStatus(''); return; }

      // Auth
      setStatus('Authenticating...');
      try {
        await authenticate(creds.username, creds.password);
      } catch (e) {
        await clearCredentials();
        throw new Error(`Authentication failed: ${e.message}`);
      }

      // Book info
      setStatus('Fetching book info...');
      const bookId = extractBookId(window.location.href);
      const productData = await getProductData(bookId);
      const title = productData.title || 'book';
      const epubId = findEpubFormat(productData);

      setStatus(`Found: ${title}`);

      // Package data
      setStatus('Fetching download info...');
      const epubPackage = await getEpubPackage(epubId);
      const key = fixKey(epubPackage.crypt_key);
      const iv = fixKey(epubPackage.crypt_iv);
      const spines = epubPackage.spines;
      const tocData = epubPackage.toc;

      // Download + decrypt fragments
      const fragments = new Array(spines.length);
      let completed = 0;

      async function downloadFragment(i) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const encrypted = await gmFetchBinary(spines[i].spine_url);
            const decrypted = await decryptData(encrypted, key, iv);
            if (decrypted[0] !== 0x50 || decrypted[1] !== 0x4B) {
              console.warn(`[Nextory DL] Fragment ${i + 1} bad PK header`);
            }
            fragments[i] = decrypted;
            completed++;
            setStatus(`Downloading... ${completed}/${spines.length}`);
            return;
          } catch (e) {
            if (attempt === 2) throw e;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
      }

      // Download with concurrency limit of 4
      const CONCURRENT = 4;
      for (let start = 0; start < spines.length; start += CONCURRENT) {
        const batch = spines.slice(start, start + CONCURRENT).map((_, j) => downloadFragment(start + j));
        await Promise.all(batch);
      }

      // Merge
      setStatus('Merging EPUB...');
      const { htmlContentMap, assetMap, tocOrder } = await mergeFragments(fragments, tocData);

      // Build EPUB
      setStatus('Building EPUB...');
      const blob = buildEpub(htmlContentMap, assetMap, tocOrder, productData);

      // Save
      const filename = `${title}.epub`;
      saveBlob(blob, filename);
      setStatus(`Done! Saved ${filename}`);
      setTimeout(() => setStatus(''), 5000);

    } catch (err) {
      setStatus(`Error: ${err.message}`);
      console.error('[Nextory DL]', err);
    } finally {
      downloading = false;
      setButtonEnabled(true);
    }
  }

  // --- Init ---
  function isBookPage() {
    return /\/book\//.test(location.pathname);
  }

  function refreshUI() {
    const old = document.getElementById('nextory-dl-container');
    if (old) old.remove();
    if (isBookPage()) injectUI();
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(refreshUI, 500);
    }
  }).observe(document.body, { childList: true, subtree: true });

  refreshUI();
})();
