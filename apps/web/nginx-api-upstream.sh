#!/bin/sh
# Runs before nginx starts (the nginx image runs /docker-entrypoint.d/*.sh). Without L2M_API_UPSTREAM it does nothing:
# the studio forwards to api:4000, the Docker Compose service, as it always has.
#
# L2M_API_UPSTREAM=host:port (for example l2m-api-x1y2:4000 on a cloud host whose services have other names) replaces
# the server of the l2m_api upstream in nginx.conf (the lines between the l2m-api-upstream markers). The name is then
# looked up through the container's DNS servers (/etc/resolv.conf) every 10 seconds instead of once at start, so nginx
# starts before the API has an address and follows it when a redeploy gives it a new one. Give a name those servers
# answer for as written: nginx does not add resolv.conf search domains (on Kubernetes, use the Service's full name).
#
# A value that is not host:port stops the container with a message instead of starting with a broken proxy.
set -eu

upstream=${L2M_API_UPSTREAM:-}
[ -n "$upstream" ] || exit 0

conf=${L2M_API_UPSTREAM_CONF:-/etc/nginx/conf.d/default.conf}
resolv_conf=${L2M_API_UPSTREAM_RESOLV_CONF:-/etc/resolv.conf}

fail() {
  echo "L2M web: $*" >&2
  exit 1
}

# host:port, where host is a DNS name or an IPv4 address. Nothing else reaches the nginx config: the case catches
# characters grep cannot see (a line break), grep the shape.
case $upstream in
  *[!A-Za-z0-9.:-]*) fail "L2M_API_UPSTREAM must be host:port (for example api:4000), not '$upstream'" ;;
esac
printf '%s' "$upstream" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?:[0-9]{1,5}$' \
  || fail "L2M_API_UPSTREAM must be host:port (for example api:4000), not '$upstream'"
port=${upstream##*:}
host=${upstream%:*}
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || fail "L2M_API_UPSTREAM has port $port, outside 1-65535"

grep -q '^# l2m-api-upstream:begin$' "$conf" && grep -q '^# l2m-api-upstream:end$' "$conf" \
  || fail "L2M_API_UPSTREAM is set, but $conf has no l2m-api-upstream block to change (a replaced nginx config?)"

# The DNS servers, IPv6 ones in brackets as nginx wants them.
resolvers=$(awk 'BEGIN { ORS = " " } $1 == "nameserver" { if ($2 ~ ":") print "[" $2 "]"; else print $2 }' "$resolv_conf" 2>/dev/null || true)
resolvers=${resolvers% }

block=$(mktemp)
trap 'rm -f "$block"' EXIT
if printf '%s' "$host" | grep -Eq '^[0-9.]+$' || [ -z "$resolvers" ]; then
  # An address, or no DNS server to ask again: looked up once at start, as for the default.
  printf 'upstream l2m_api {\n  server %s;\n}\n' "$upstream" > "$block"
else
  printf 'upstream l2m_api {\n  zone l2m_api 64k;\n  resolver %s valid=10s;\n  server %s resolve;\n}\n' "$resolvers" "$upstream" > "$block"
fi

next="$conf.l2m-next"
awk -v block="$block" '
  /^# l2m-api-upstream:begin$/ { print; while ((getline line < block) > 0) print line; skip = 1; next }
  /^# l2m-api-upstream:end$/ { skip = 0 }
  !skip { print }
' "$conf" > "$next" || fail "could not write $next"
mv -f "$next" "$conf" || fail "could not replace $conf"
echo "L2M web: forwarding the API routes to $upstream"
