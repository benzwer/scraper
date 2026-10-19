#!/bin/sh
# Runs the command as the owner of the mounted user/ folder (the person who set up the scraper),
# so the container reads that folder and the files it writes in data/ and browser-profile/
# belong to that person, whatever their uid. The image user "ubuntu" takes that uid and gid.
set -eu

uid=$(stat -c %u /app/user)
gid=$(stat -c %g /app/user)

# A folder owned by root is one that Docker created because it was missing: never run as root.
if [ "$uid" = 0 ]; then
  echo "user/ is owned by root: create it as your user (mkdir -p user data browser-profile)" >&2
  exit 1
fi

if [ "$(id -g ubuntu)" != "$gid" ]; then groupmod -o -g "$gid" ubuntu; fi
if [ "$(id -u ubuntu)" != "$uid" ]; then usermod -o -u "$uid" ubuntu; fi

exec setpriv --reuid="$uid" --regid="$gid" --init-groups env HOME=/home/ubuntu USER=ubuntu "$@"
