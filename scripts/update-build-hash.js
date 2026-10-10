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
// [v2.23.0] 排除项里的 about.md / music/about.md 已随旧版播放器删除；
// music/bin 仍要保留排除（内含 fpcalc 二进制，体积大且内容固定，不该参与哈希）。
const publicHash = getDirectoryHash(path.join(targetDir, 'public'), ['music/bin'], []);
const srcHash = getDirectoryHash(path.join(targetDir, 'src'), [], []);

const finalHash = crypto.createHash('md5').update(publicHash + srcHash).digest('hex').substring(0, 7);

// 同步项目版本号到 package.json。[v2.23.0 起 config.js 已随旧版播放器删除]
//
// 历史背景：本项目曾有**三处版本号**长期漂移（`version` 文件 / `public/js/config.js` /
// `package.json`），后两者分别被 release.yml（当 Release 名）与 electron-builder
// （当桌面端产物名）消费，都停在 2.1.1 漂了 20 多个版本。
// v2.22.1 起统一由本脚本从根 `version` 同步；v2.23.0 删掉 config.js 后只剩 package.json 一处。
//
// 服务端的版本号已不再依赖 config.js：
//   - `/app/config.json` 用 `readAppVersion()` 直接读根 `version` 文件
//   - 旧版 `/js/config.js` 注入通道随旧版播放器一并移除
const versionPath = path.join(targetDir, 'version');
const projectVersion = fs.existsSync(versionPath)
    ? fs.readFileSync(versionPath, 'utf8').trim()
    : '';

if (projectVersion) {
    // package.json：**不带 v 前缀**（semver 要求，electron-builder 也按 semver 解析）
    const pkgPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkgVersion = projectVersion.replace(/^v/, '');
        const pkgContent = fs.readFileSync(pkgPath, 'utf8');
        // 用带缩进的精确替换，避免误伤依赖里的 "version" 字段
        const next = pkgContent.replace(
            /("version"\s*:\s*")[^"]*(")/,
            `$1${pkgVersion}$2`,
        );
        if (next !== pkgContent) {
            fs.writeFileSync(pkgPath, next);
            console.log(`Version synced to ${pkgVersion} in package.json`);
        }
    }
}

/**
 * 给 HTML 里引用本仓库静态资源的标签追加 `?v=<hash>`。
 *
 * **v2.23.0 起此函数已无调用方**：它原本服务于旧版播放器的 index.html /
 * music/index.html / music/login.html / filemanager.html，这些文件已随旧版删除。
 * 新前端 /app 由 Vite 构建，产物文件名自带内容哈希（`index-<hash>.js`），
 * 天然具备缓存失效能力，不需要这套 `?v=` 注入。
 *
 * 保留实现是为了：若将来又出现「不带哈希的静态 HTML 引用」场景可直接复用；
 * 一旦确认不再需要，可连同下方 htmlFiles 循环一并删除。
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

// [v2.23.0] 原本这里会把 buildHash 注入旧版播放器的 4 个 HTML（index.html /
// music/index.html / music/login.html / filemanager.html）。那些文件已随旧版删除，
// 新前端 /app 由 Vite 产出带内容哈希的文件名，不需要这一步。
// 保留一段空判断以便将来需要时快速恢复（也避免脚本静默什么都不做让人困惑）。
const legacyHtmlFiles = []; // 如需恢复：['index.html', 'music/index.html', ...]
let stamped = 0;
for (const f of legacyHtmlFiles) {
    if (stampAssetVersion(path.join(targetDir, 'public', f))) {
        console.log(`Stamped asset version ${finalHash} into ${f}`);
        stamped++;
    }
}
