# Nextory EPUB Downloader

Tampermonkey/Violentmonkey userscript that downloads EPUB books from Nextory.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Open `nextory-dl.user.js` and click "Raw" (or install from URL)
3. Navigate to any book page on nextory.com

## Usage

1. Go to a book page on nextory.com (e.g. `https://nextory.com/se/book/...`)
2. Click the "Download EPUB" button that appears on the page
3. Enter your Nextory credentials when prompted (stored locally, never sent anywhere else)
4. Wait for download to complete

## How it works

- Authenticates with the Nextory API using your credentials
- Fetches book metadata and encrypted EPUB fragments
- Decrypts fragments using AES-CBC (Web Crypto API)
- Merges fragments into a single valid EPUB
- Triggers a browser download of the final file

## Requirements

- A valid Nextory subscription with access to the book
- A modern browser with Tampermonkey/Violentmonkey installed
