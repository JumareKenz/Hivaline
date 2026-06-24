/**
 * Fetch artifact with authentication
 */
import fs from 'fs';
import https from 'https';

const COMPILER_API = 'https://compiler.hiva.chat/api/hiv';

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(COMPILER_API + path);
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function downloadBinary(url, outputPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(outputPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log('Getting version metadata...');
    const meta = await request('GET', '/version');
    console.log(`Latest: ${meta.version} (${meta.chunk_count} chunks, ${(meta.size_kb/1024).toFixed(1)}MB)`);

    console.log('\nAttempting auth...');
    const auth = await request('POST', '/auth', {});
    console.log(`Auth response:`, auth);

    if (auth.token) {
      console.log(`\n✓ Got token: ${auth.token.substring(0, 20)}...`);
      console.log('Downloading artifact...');
      await downloadBinary(`${COMPILER_API}/download?token=${auth.token}`, `hiv-cache-${meta.version}.bin`);
      console.log(`✓ Downloaded: hiv-cache-${meta.version}.bin`);
      fs.copyFileSync(`hiv-cache-${meta.version}.bin`, 'hiv-cache.bin');
      console.log('✓ Replaced hiv-cache.bin');
    } else {
      console.log('No token in response');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
