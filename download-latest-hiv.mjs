// Download latest .hiv file from compiler endpoint
import fs from 'fs';
import https from 'https';

const UPDATE_ENDPOINT = 'https://compiler.hiva.chat/api/hiv';

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/octet-stream',
      },
    }, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(outputPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errorData}`)));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    // Get version metadata
    console.log('Fetching version metadata...');
    const meta = await fetchJSON(`${UPDATE_ENDPOINT}/version`);
    console.log(`Latest version: ${meta.version}`);
    console.log(`Size: ${(meta.size_kb / 1024).toFixed(2)}MB`);
    console.log(`Chunks: ${meta.chunk_count}`);
    console.log(`Created: ${meta.created_at}`);

    // Download file
    console.log('\nDownloading...');
    const outputPath = `hiv-cache-${meta.version}.bin`;
    await download(`${UPDATE_ENDPOINT}/download`, outputPath);

    const stats = fs.statSync(outputPath);
    console.log(`\n✅ Downloaded: ${outputPath}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    // Replace current cache
    console.log('\nReplacing hiv-cache.bin...');
    fs.copyFileSync(outputPath, 'hiv-cache.bin');
    console.log('✅ Done!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
