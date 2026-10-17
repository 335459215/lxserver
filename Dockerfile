FROM alpine AS base

FROM base AS builder
WORKDIR /source-code
COPY . .

RUN apk add --update \
  g++ \
  make \
  py3-pip \
  nodejs \
  npm \
  && (apk add --no-cache chromaprint || true) \
  && npm install --ignore-scripts --no-audit --no-fund && npm run build \
  && cd web && npm install --no-audit --no-fund && npm run build && cd .. \
  && rm -rf node_modules && npm install --omit=dev --no-audit --no-fund \
  && mkdir -p build-output \
  && mv server node_modules config.js index.js package.json public version -t build-output


FROM base AS final
WORKDIR /server

RUN apk add --update --no-cache nodejs \
  && (apk add --no-cache chromaprint || echo "chromaprint apk not found, will use bundled binary")

COPY --from=builder ./source-code/build-output ./

VOLUME /server/data
ENV DATA_PATH='/server/data'
ENV LOG_PATH='/server/data/logs'

EXPOSE 9527
ENV NODE_ENV='production'
ENV PORT=9527
# 【不要在这里硬编码 BIND_IP】环境变量的优先级**高于** config.js
# （index.ts 里 envParams.BIND_IP 会覆盖配置文件）。此前这里写着
# `ENV BIND_IP='0.0.0.0'`，导致用户在 config.js 里设 bindIP 永远无效 ——
# 实测把 config.js 改成 127.0.0.1 后，容器仍监听 0.0.0.0，且日志/接口
# 都显示 0.0.0.0，极难定位。需要固定监听地址时由使用者在 compose.yaml
# 的 environment 里显式给 BIND_IP（那是用户的明确意图），镜像不替他决定。
# ENV BIND_IP='0.0.0.0'
# ENV PROXY_HEADER 'x-real-ip'
# ENV SERVER_NAME 'My Sync Server'
# ENV MAX_SNAPSHOT_NUM '10'
# ENV LIST_ADD_MUSIC_LOCATION_TYPE 'top'
# ENV LX_USER_user1 '123.123'
# ENV LX_USER_user2 '{ "password": "123.456", "maxSnapshotNum": 10, "list.addMusicLocationType": "top" }'
# ENV CONFIG_PATH '/server/data/config.js'
# ENV WEBDAV_URL ''
# ENV WEBDAV_USERNAME ''
# ENV WEBDAV_PASSWORD ''
# ENV SYNC_INTERVAL '60'
# ENV ENABLE_WEBPLAYER_AUTH 'false'
# ENV WEBPLAYER_PASSWORD '123456'
# ENV LOG_PATH '/server/logs'
# ENV DATA_PATH '/server/data'
# ENV PLAYER_ENABLE_AUTH 'true'
# ENV PLAYER_PASSWORD '123.456'

CMD [ "node", "index.js" ]
