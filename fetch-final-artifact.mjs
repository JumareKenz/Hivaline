import fs from 'fs';
import https from 'https';

const API_BASE = 'https://compiler.hiva.chat';
const SERVER_CODE = 'HIVA-FP9A';
const ACCESS_KEY = 'FP9A';

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, buffer, headers: res.headers });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${buffer.toString()}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  try {
    console.log('Logging in...');
    const authRes = await httpsRequest(`${API_BASE}/api/hiv/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_code: SERVER_CODE, access_key: ACCESS_KEY }),
    });
    const authData = JSON.parse(authRes.buffer.toString());
    const token = authData.token;
    console.log(`✓ Token acquired\n`);

    console.log('Fetching version info...');
    const versionRes = await httpsRequest(`${API_BASE}/api/hiv/version`);
    const meta = JSON.parse(versionRes.buffer.toString());
    console.log(`Latest version: ${meta.version} (${meta.chunk_count} chunks, ${(meta.size_kb/1024).toFixed(1)}MB)`);

    // Check if this is the right version
    if (meta.version !== '2026.06.24.61') {
      console.log(`⚠️  Expected 2026.06.24.61 but got ${meta.version}`);
    }

    console.log('\nDownloading artifact...');
    const downloadRes = await httpsRequest(`${API_BASE}/api/hiv/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream',
      },
    });

    const outputPath = 'hiv-cache.bin';
    fs.writeFileSync(outputPath, downloadRes.buffer);
    const stats = fs.statSync(outputPath);
    console.log(`✓ Downloaded and saved: ${(stats.size / 1024 / 1024).toFixed(2)}MB\n`);
    console.log(`Ready for offline Phase 24 testing`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
