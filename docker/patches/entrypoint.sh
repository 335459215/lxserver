#!/bin/sh
# lxserver entrypoint: patch HTML + ServiceWorker, then start server with gzip

# 1. Patch music/index.html: inject fix-storage.js + perf-optimizer.js before </head>
if ! grep -q fix-storage /server/public/music/index.html 2>/dev/null; then
  sed -i 's|</head>|<script src="/js/fix-storage.js"></script><script src="/js/perf-optimizer.js"></script></head>|' \
    /server/public/music/index.html /server/public/music/login.html
fi

# 2. Patch music/index.html: add defer to body script tags (skip head scripts like /js/config.js)
sed -i 's|<script src="js/|<script defer src="js/|g' /server/public/music/index.html 2>/dev/null
sed -i 's|<script src="app.js|<script defer src="app.js|g' /server/public/music/index.html 2>/dev/null
sed -i 's|<script src="https://cdnjs|<script defer src="https://cdnjs|g' /server/public/music/index.html 2>/dev/null
sed -i 's|<script defer defer|<script defer|g' /server/public/music/index.html 2>/dev/null

# 3. Copy patched ServiceWorker (stale-while-revalidate + complete precache)
if [ -f /server/data/patches/sw-patched.js ]; then
  cp /server/data/patches/sw-patched.js /server/public/music/sw.js
fi

# 4. Start server with gzip compression patch preloaded
exec node -r /server/data/patches/gzip-patch.js index.js
