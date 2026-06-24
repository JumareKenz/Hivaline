// Login with FP9A and download .hiv file
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
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function main() {
  try {
    // Login
    console.log('Logging in with access code FP9A...');
    const authRes = await httpsRequest(`${API_BASE}/api/hiv/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        server_code: SERVER_CODE,
        access_key: ACCESS_KEY,
      }),
    });

    const authData = JSON.parse(authRes.buffer.toString());
    console.log(`✅ Logged in as: ${authData.user_profile.name}`);
    console.log(`Token: ${authData.token.substring(0, 30)}...`);

    // Get version
    console.log('\nFetching version info...');
    const versionRes = await httpsRequest(`${API_BASE}/api/hiv/version`);
    const meta = JSON.parse(versionRes.buffer.toString());
    console.log(`Version: ${meta.version}`);
    console.log(`Size: ${(meta.size_kb / 1024).toFixed(2)}MB`);
    console.log(`Chunks: ${meta.chunk_count}`);

    // Download
    console.log('\nDownloading .hiv file...');
    const downloadRes = await httpsRequest(`${API_BASE}/api/hiv/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authData.token}`,
        'Accept': 'application/octet-stream',
      },
    });

    console.log(`✅ Downloaded ${(downloadRes.buffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Save
    const outputPath = 'hiv-cache.bin';
    fs.writeFileSync(outputPath, downloadRes.buffer);
    console.log(`✅ Saved as ${outputPath}`);

    const stats = fs.statSync(outputPath);
    console.log(`\nFile size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
    console.log('Ready to test!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
