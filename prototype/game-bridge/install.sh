#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# First installation only. No changes to existing services, firewall or tunnels.
ROOT=/opt/game-bridge
NAME=game-bridge-prototype
IMAGE=game-bridge-prototype:0.1.1
HTTP_PORT=${GAME_HTTP_PORT:-3077}
TLS_PORT=${GAME_TLS_PORT:-3447}
PUBLIC_IP=${GAME_PUBLIC_IP:-94.125.101.253}
MODE=${1:---install}
SRC=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
die() { echo "ОСТАНОВКА: $*" >&2; exit 1; }
[[ "$MODE" == --install || "$MODE" == --check ]] || die 'Режим: --check или --install'
[[ $EUID == 0 ]] || die 'Запусти из root в ConnectBot.'
for tool in docker curl openssl python3 ss df timeout sha256sum; do
  command -v "$tool" >/dev/null || die "Не найден $tool. Системные пакеты автоматически не устанавливаются."
done
[[ -f "$SRC/SHA256SUMS" ]] || die 'Неполный архив: отсутствует SHA256SUMS.'
(cd "$SRC" && sha256sum --quiet -c SHA256SUMS) || die 'Контрольные суммы архива не совпадают.'
python3 - "$PUBLIC_IP" <<'PY'
import ipaddress,sys
ipaddress.IPv4Address(sys.argv[1])
PY
for port in "$HTTP_PORT" "$TLS_PORT"; do
  [[ "$port" =~ ^[0-9]{4,5}$ ]] || die 'Некорректный порт.'
  (( port >= 1024 && port <= 65535 )) || die 'Порт вне диапазона.'
  case "$port" in 3000|3001|3002|3003|3004|3100|8080|8081) die "Порт $port принадлежит существующему контуру.";; esac
  [[ -z "$(ss -H -ltn "sport = :$port")" ]] || die "Порт $port уже занят. Ничего не остановлено."
done
[[ "$HTTP_PORT" != "$TLS_PORT" ]] || die 'Нужны разные порты HTTP и HTTPS.'
timeout 15 docker info >/dev/null 2>&1 || die 'Docker не ответил за 15 секунд.'
if docker container inspect "$NAME" >/dev/null 2>&1; then
  die "Контейнер $NAME уже существует. Повторная установка не перезаписывает его."
fi
[[ ! -e "$ROOT" ]] || die "$ROOT уже существует. Ничего не перезаписано."
docker_root=$(docker info --format '{{.DockerRootDir}}')
python3 - "$docker_root" <<'PY'
import shutil,sys
for p in ('/opt',sys.argv[1]):
    d=shutil.disk_usage(p)
    print(f'{p}: свободно {d.free/1024**3:.2f} GB ({d.free/1024**2:.0f} MB)')
    if d.free < 900*1024**2:
        raise SystemExit('Нужно минимум 900 MB свободного места. Автоочистка запрещена и не выполняется.')
PY
echo "Проверка пройдена. Новый контур: $ROOT; локальный HTTP $HTTP_PORT; внешний HTTPS $TLS_PORT."
if [[ "$MODE" == --check ]]; then exit 0; fi

mkdir -m 700 "$ROOT"
echo 'Подготовка исходников…'
cp "$SRC"/{Dockerfile,package.json,package-lock.json,server.mjs,store.mjs,test.mjs,agent.mjs} "$ROOT/"
cp -R "$SRC/public" "$ROOT/public"
chmod 644 "$ROOT"/{Dockerfile,package.json,package-lock.json,server.mjs,store.mjs,test.mjs,agent.mjs}
chmod 755 "$ROOT/public"
chmod 644 "$ROOT/public"/*
mkdir -m 700 "$ROOT/data" "$ROOT/tls"
chown 1000:1000 "$ROOT/data" "$ROOT/tls"
python3 - "$ROOT" "$PUBLIC_IP" "$TLS_PORT" <<'PY'
import pathlib,secrets,sys
p=pathlib.Path(sys.argv[1]); ip=sys.argv[2]; port=sys.argv[3]
player=secrets.token_hex(32); agent=secrets.token_hex(32)
(p/'.env').write_text(f'PLAYER_TOKEN={player}\nAGENT_TOKEN={agent}\nPUBLIC_ORIGIN=https://{ip}:{port}\nTLS_PORT=3447\nTLS_CERT=/tls/server.crt\nTLS_KEY=/tls/server.key\n')
(p/'player-url.txt').write_text(f'https://{ip}:{port}/#token={player}\n')
PY
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 90 \
  -keyout "$ROOT/tls/server.key" -out "$ROOT/tls/server.crt" \
  -subj "/CN=$PUBLIC_IP" -addext "subjectAltName=IP:$PUBLIC_IP,IP:127.0.0.1" >/dev/null 2>&1
chmod 600 "$ROOT/tls/server.key" "$ROOT/.env" "$ROOT/player-url.txt"
chown 1000:1000 "$ROOT/tls/server.key" "$ROOT/tls/server.crt"
echo 'Сборка отдельного образа. При первом запуске загружается Node.js 24…'
docker build --label app=game-bridge-prototype -t "$IMAGE" "$ROOT"
echo 'Интеграционные тесты внутри нового образа…'
docker run --rm --network none --memory 192m --cpus 0.5 --pids-limit 64 \
  --mount "type=bind,src=$ROOT/test.mjs,dst=/app/test.mjs,readonly" "$IMAGE" node --test test.mjs
echo 'Запуск…'
docker run -d --name "$NAME" --label app=game-bridge-prototype \
  --restart unless-stopped --memory 192m --cpus 0.5 --pids-limit 64 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --log-opt max-size=2m --log-opt max-file=2 \
  --env-file "$ROOT/.env" \
  -p "127.0.0.1:$HTTP_PORT:3077" -p "0.0.0.0:$TLS_PORT:3447" \
  --mount "type=bind,src=$ROOT/data,dst=/data" \
  --mount "type=bind,src=$ROOT/tls,dst=/tls,readonly" "$IMAGE" >/dev/null
healthy=0
for attempt in {1..20}; do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$HTTP_PORT/health" >/dev/null && \
     curl --silent --fail --max-time 2 --cacert "$ROOT/tls/server.crt" "https://127.0.0.1:$TLS_PORT/health" >/dev/null; then
    healthy=1; break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  docker stop "$NAME" >/dev/null || true
  die "Новый контейнер не прошёл health-проверку и остановлен. Диагностика: docker logs $NAME. Остальные службы не изменены."
fi
echo 'УСТАНОВЛЕНО. Локальные проверки HTTP и HTTPS прошли.'
echo 'Личная ссылка игрока (не публиковать):'
cat "$ROOT/player-url.txt"
echo "MCP для отдельного защищённого подключения: http://127.0.0.1:$HTTP_PORT/mcp"
echo 'GPT ещё не подключён. Отсутствие его ответа сейчас ожидаемо.'
echo 'Сертификат самоподписанный: браузер попросит подтверждение открытия.'
echo 'Отпечаток сертификата для сверки:'
openssl x509 -in "$ROOT/tls/server.crt" -noout -fingerprint -sha256
echo "При внешнем таймауте проверить доступность TCP $TLS_PORT в панели VPS. Этот установщик firewall не меняет."
