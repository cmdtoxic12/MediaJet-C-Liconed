/**
 * MediaJet Frontend v2
 * Talks only to our own backend – RapidAPI key never leaves the server.
 */

let selectedPlatform = '';
let selectedFormat = 'mp4';

const bgm = document.getElementById('bgm');
const resultDisplay = document.getElementById('result-display');
const extractBtn = document.querySelector('.extract-btn');
const urlInput = document.getElementById('videoUrl');

function setPlatform(name, btn) {
    selectedPlatform = name;
    document.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    urlInput.placeholder = `Link to ${name} media...`;
    bgm.play().catch(() => {});
}

function setFormat(format) {
    selectedFormat = format;
    document.querySelectorAll('.format-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`${format}-btn`).classList.add('active');
}

async function triggerDownload() {
    const url = urlInput.value.trim();
    resultDisplay.style.display = 'none';
    resultDisplay.classList.remove('error-box');
    resultDisplay.innerHTML = '';

    if (!selectedPlatform) {
        alert('Please select a platform first!');
        return;
    }
    if (!url) {
        alert('Please paste a link!');
        return;
    }

    extractBtn.innerText = `FETCHING ${selectedFormat.toUpperCase()}...`;
    extractBtn.disabled = true;

    try {
        const response = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, format: selectedFormat })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `Request failed (${response.status})`);
        }

        const { title, author, thumbnail, media, downloadUrl } = data;
        const quality = media.quality || media.extension || selectedFormat;

        extractBtn.innerText = 'STARTING DOWNLOAD...';

        const success = await attemptDownload(downloadUrl, media.url);

        if (success) {
            extractBtn.innerText = 'DOWNLOAD STARTED!';
            showSuccessCard(title, author, quality, thumbnail, downloadUrl, false);
        } else {
            showSuccessCard(title, author, quality, thumbnail, downloadUrl, true);
            extractBtn.innerText = 'CLICK BELOW TO SAVE';
        }
    } catch (error) {
        console.error(error);
        showError(error.message || 'Failed to extract media. Check the link or try again later.');
        extractBtn.innerText = 'ERROR';
    } finally {
        setTimeout(() => {
            if (!extractBtn.innerText.includes('ERROR') && !extractBtn.innerText.includes('CLICK BELOW')) {
                extractBtn.innerText = 'DOWNLOAD';
            }
            extractBtn.disabled = false;
        }, 4500);
    }
}

async function attemptDownload(proxyUrl, directUrl) {
    // Method 1: Navigate to the same-origin proxy (best – forces filename)
    try {
        const link = document.createElement('a');
        link.href = proxyUrl;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return true;
    } catch (e) {
        console.warn('Proxy click failed:', e);
    }

    // Method 2: Fetch proxy as blob
    try {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Proxy fetch failed');
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `MediaJet_${selectedPlatform}_${Date.now()}.${selectedFormat}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 300);
        return true;
    } catch (e) {
        console.warn('Blob via proxy failed:', e);
    }

    // Method 3: Direct media URL
    try {
        const a = document.createElement('a');
        a.href = directUrl;
        a.download = `MediaJet_${selectedPlatform}.${selectedFormat}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return true;
    } catch (e) {
        console.warn('Direct link failed:', e);
        return false;
    }
}

function showSuccessCard(title, author, quality, thumbnail, downloadUrl, isManual) {
    resultDisplay.classList.remove('error-box');

    let html = '';
    if (thumbnail) {
        html += `<img class="thumb" src="${escapeHtml(thumbnail)}" alt="thumbnail" loading="lazy">`;
    }
    html += `<p class="result-title">${escapeHtml(title)}</p>`;
    if (author) {
        html += `<p class="result-meta">by ${escapeHtml(author)}</p>`;
    }
    html += `<p class="result-meta">Quality: ${escapeHtml(quality)} · ${selectedFormat.toUpperCase()}</p>`;

    if (isManual) {
        html += `<a class="manual-dl" href="${downloadUrl}">📥 DOWNLOAD ${selectedFormat.toUpperCase()}</a>`;
    } else {
        html += `<p style="margin:0 0 10px 0;font-size:0.85rem;color:#4ade80;">Download should have started.</p>
                 <a class="manual-dl" href="${downloadUrl}">📥 SAVE AGAIN</a>`;
    }

    resultDisplay.innerHTML = html;
    resultDisplay.style.display = 'block';
}

function showError(message) {
    resultDisplay.classList.add('error-box');
    resultDisplay.innerHTML = `
        <p class="result-title" style="color:#fca5a5;">Extraction failed</p>
        <p class="result-meta">${escapeHtml(message)}</p>
    `;
    resultDisplay.style.display = 'block';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

window.setPlatform = setPlatform;
window.setFormat = setFormat;
window.triggerDownload = triggerDownload;
