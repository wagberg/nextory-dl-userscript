# Nextory EPUB & Audiobook Downloader

Tampermonkey/Violentmonkey userscript that downloads ebooks and audiobooks from Nextory.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Open `nextory-dl.user.js` and click "Raw" (or install from URL)
3. Navigate to any book page on nextory.com

## Usage

1. Go to a book page on nextory.com (e.g. `https://nextory.com/se/book/...`)
2. Available buttons appear based on what formats the book has:
   - **Download EPUB** — for ebooks
   - **Download Audiobook** — for audiobooks
3. Enter your Nextory credentials when prompted (stored locally)
4. Wait for download to complete

### Converting audiobook to M4B with chapters

The audiobook downloads as a `.aac` file plus a `.chapters.txt` metadata file. To combine them into a chaptered M4B:

```bash
ffmpeg -i "Book Title.aac" -i "Book Title.chapters.txt" -map_metadata 1 -c copy "Book Title.m4b"
```

The metadata file includes title, author, narrator, series, and chapter markers.

## How it works

### Ebooks
- Authenticates with the Nextory API
- Fetches encrypted EPUB fragments and decrypts them (AES-CBC)
- Merges fragments into a single valid EPUB using fflate

### Audiobooks
- Fetches HLS audio package (chapter list with playlist URLs)
- Parses M3U8 playlists and downloads AAC segments
- Decrypts encrypted segments (AES-128-CBC)
- Concatenates into a single AAC file with ffmpeg chapter metadata

## Requirements

- A valid Nextory subscription with access to the book
- A modern browser with Tampermonkey/Violentmonkey
- ffmpeg (optional, for converting audiobooks to chaptered M4B)
