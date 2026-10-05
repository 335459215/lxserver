const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getDirectoryHash(dir, exclude = [], extensions = []) {
    const files = [];

    function readDir(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(dir, fullPath).replace(/\\/g, '/'); // normalize slashes for exclude array

            // exclude matches
            if (exclude.some(ex => relPath.startsWith(ex) || entry.name === ex)) {
                continue;
            }

            if (entry.isDirectory()) {
                readDir(fullPath);
            } else if (entry.isFile()) {
                if (extensions.length === 0 || extensions.some(ext => entry.name.endsWith(ext))) {
                    files.push(fullPath);
                }
            }
        }
    }

    readDir(dir);

    // Sort files to ensure stable hash
    files.sort();

    const hash = crypto.createHash('md5');
    for (const file of files) {
        const content = fs.readFileSync(file);
        const ext = path.extname(file).toLowerCase();
        const textExtensions = ['.js', '.ts', '.json', '.html', '.css', '.md', '.svg', '.txt', '.cjs', '.mjs', '.xml', '.yaml', '.yml'];

        if (textExtensions.includes(ext)) {
            // 统一将 CRLF 转换为 LF 再计算 Hash，确保跨平台一致性
            let text = content.toString('utf8').replace(/\r\n/g, '\n');
            // HTML 里带 ?v=<hash> 的资源版本号必须从 hash 输入中剔除。
            // 否则会自我循环：上一轮注入的版本号改变了 HTML 内容 → 改变了 hash →
            // 下一轮算出新 hash，但注入逻辑又会跳过「已有 ?v=」的 URL，版本号就此
            // 永久卡住不再更新，资源版本机制静默失效（实测 hash 与 HTML 里的
            // ?v= 永久分叉）。剔除后 hash 只反映真实内容，与注入结果无关。
            if (ext === '.html') {
                text = text.replace(/([?&])v=[a-f0-9]+/g, '$1');
            }
            hash.update(text);
        } else {
            hash.update(content);
        }
    }

    return hash.digest('hex');
}

const targetDir = path.resolve(__dirname, '../');

// We exclude config.js/about.md itself to avoid infinite hash changes when injecting the hash.
// Also ignore logs, data, server (dist), node_modules, .git.
const publicHash = getDirectoryHash(path.join(targetDir, 'public'), ['js/config.js', 'about.md', 'music/about.md', 'music/bin'], []);
const srcHash = getDirectoryHash(path.join(targetDir, 'src'), [], []);

const finalHash = crypto.createHash('md5').update(publicHash + srcHash).digest('hex').substring(0, 7);

// Update config.js
const configPath = path.join(targetDir, 'public', 'js', 'config.js');
if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, 'utf8');

    if (configContent.includes('buildHash:')) {
        configContent = configContent.replace(/buildHash:\s*['"][a-f0-9]+['"]/, `buildHash: '${finalHash}'`);
    } else {
        configContent = configContent.replace(/(window\.CONFIG\s*=\s*\{)/, `$1\n    buildHash: '${finalHash}',`);
    }

    fs.writeFileSync(configPath, configContent);
    console.log(`Build hash updated to ${finalHash} in config.js`);
}

/**
 * 给 HTML 里引用本仓库静态资源的标签追加 `?v=<hash>`。
 *
 * 为什么必须做：index.html 走 no-cache 每次都回源，但被它引用的 app.js 之类
 * 之前是 7 天强缓存，且文件名不带内容哈希。浏览器一旦缓存过某个版本，在
 * max-age 到期前即使服务端已经更新也不会重新请求——实测改了换源提示组件、
 * 服务端文件已是新版，浏览器仍在跑旧版，验证时一度以为部署失败。
 *
 * 只改响应头救不了已经缓存的副本，必须让 URL 本身随版本变化。
 * HTML 不缓存，所以每次发版后浏览器重新拿到 HTML，里面的 ?v 已是新值，
 * 于是所有本地资源都被判定为新资源重新下载。
 */
function stampAssetVersion(htmlPath) {
    if (!fs.existsSync(htmlPath)) return 0;
    let html = fs.readFileSync(htmlPath, 'utf8');
    const before = html;

    // 只处理本地相对/根路径引用，跳过带协议与 data: 的。
    // 已有 ?v= 的要「替换」而不是跳过——跳过会让版本号永久卡在第一次注入的值上。
    const withVersion = (url) => {
        if (!url) return url;
        if (/^[a-z]+:/i.test(url) || url.startsWith('//') || url.startsWith('data:')) return url;
        const cleaned = url.replace(/([?&])v=[a-f0-9]+/g, '$1').replace(/[?&]$/, '');
        return `${cleaned}${cleaned.includes('?') ? '&' : '?'}v=${finalHash}`;
    };

    html = html.replace(/(<script\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
        (m, pre, q, url) => `${pre}${q}${withVersion(url)}${q}`);
    html = html.replace(/(<link\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi,
        (m, pre, q, url) => `${pre}${q}${withVersion(url)}${q}`);

    if (html !== before) {
        fs.writeFileSync(htmlPath, html);
        return 1;
    }
    return 0;
}

const htmlFiles = ['index.html', 'music/index.html', 'music/login.html', 'filemanager.html'];
let stamped = 0;
for (const f of htmlFiles) {
    if (stampAssetVersion(path.join(targetDir, 'public', f))) {
        console.log(`Stamped asset version ${finalHash} into ${f}`);
        stamped++;
    }
}
if (stamped === 0) console.log('Asset version already up to date in HTML files');
