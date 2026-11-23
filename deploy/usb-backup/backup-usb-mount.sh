#!/usr/bin/env bash
set -euo pipefail

# Mounts the external USB backup drive at a stable path so pwa-admin can
# detect and write to it without ever calling mount/umount itself. Triggered
# by /etc/udev/rules.d/99-backup-usb.rules on hotplug (works headless — no
# desktop session/polkit agent required, unlike udisks2 auto-mount).

MOUNTPOINT="/media/backup-usb"
MAPPER="backup-usb-crypt"
KEYFILE="/etc/pwa-admin/usb-luks.key"

# ExecStop path: unmount, then close the LUKS mapping if there is one so an
# ejected encrypted drive is really locked again, not just unmounted.
#
# This also runs when the drive is yanked without ejecting (udev "remove"), where
# a plain umount/close can fail on a device that no longer exists. Fall back to
# a lazy unmount and a forced dm removal so nothing stale is left behind.
if [ "${1:-}" = "--stop" ]; then
  if mountpoint -q "$MOUNTPOINT"; then
    umount "$MOUNTPOINT" 2>/dev/null || umount -l "$MOUNTPOINT" 2>/dev/null || true
  fi
  if [ -e "/dev/mapper/${MAPPER}" ]; then
    cryptsetup close "$MAPPER" 2>/dev/null || dmsetup remove --force "$MAPPER" 2>/dev/null || true
  fi
  exit 0
fi

DEVNAME="$1"  # e.g. sda1, from udev's %k
DEVPATH="/dev/${DEVNAME}"
# Substituted by install.sh at install time with the pwa-admin service
# account's real uid/gid (`id -u`/`id -g`) — a dedicated system account does
# NOT get uid/gid 1000 (that's the conventional first-human-user id on
# Debian/Ubuntu), so a literal 1000 here would mount the drive owned by the
# wrong account and the service couldn't write to it.
BACKUP_UID=__PWA_ADMIN_UID__
BACKUP_GID=__PWA_ADMIN_GID__

mkdir -p "$MOUNTPOINT"

# After an unplug without eject, a dead mount and/or a dm-crypt mapping whose
# backing disk is gone can linger and block the next mount ("already mounted",
# stale mapper). Clear them before mounting anything.
clear_stale() {
  local src backing
  if mountpoint -q "$MOUNTPOINT"; then
    src="$(findmnt -n -o SOURCE "$MOUNTPOINT" 2>/dev/null || true)"
    if [ -z "$src" ] || [ ! -e "$src" ] || ! timeout 5 ls "$MOUNTPOINT" >/dev/null 2>&1; then
      umount -l "$MOUNTPOINT" 2>/dev/null || true
    fi
  fi
  if [ -e "/dev/mapper/${MAPPER}" ] && ! mountpoint -q "$MOUNTPOINT"; then
    backing="$(cryptsetup status "$MAPPER" 2>/dev/null | awk '/^ *device:/{print $2}' || true)"
    if [ -z "$backing" ] || [ ! -b "$backing" ]; then
      cryptsetup close "$MAPPER" 2>/dev/null || dmsetup remove --force "$MAPPER" 2>/dev/null || true
    fi
  fi
}
clear_stale

FSTYPE="$(lsblk -no FSTYPE "$DEVPATH")"

case "$FSTYPE" in
  exfat)
    mount -t exfat -o "uid=${BACKUP_UID},gid=${BACKUP_GID},umask=0007" "$DEVPATH" "$MOUNTPOINT"
    ;;
  vfat)
    mount -t vfat -o "uid=${BACKUP_UID},gid=${BACKUP_GID},umask=0007" "$DEVPATH" "$MOUNTPOINT"
    ;;
  ntfs)
    mount -t ntfs3 -o "uid=${BACKUP_UID},gid=${BACKUP_GID},umask=0007" "$DEVPATH" "$MOUNTPOINT"
    ;;
  ext4|ext3|ext2|xfs|btrfs)
    mount "$DEVPATH" "$MOUNTPOINT"
    chown "${BACKUP_UID}:${BACKUP_GID}" "$MOUNTPOINT"
    ;;
  crypto_LUKS)
    if mountpoint -q "$MOUNTPOINT"; then exit 0; fi
    # Auto-unlock only when the admin enabled the keyfile; otherwise the unit
    # stays active with the drive locked until the passphrase is entered in the
    # app (backup-usb-luks.sh unlock) — exiting non-zero here would make udev
    # retry/log failures for a perfectly normal state.
    if [ ! -e "/dev/mapper/${MAPPER}" ]; then
      if [ -r "$KEYFILE" ]; then
        cryptsetup open --type luks --key-file "$KEYFILE" "$DEVPATH" "$MAPPER" || true
      fi
    fi
    if [ -e "/dev/mapper/${MAPPER}" ]; then
      mount "/dev/mapper/${MAPPER}" "$MOUNTPOINT"
      chown "${BACKUP_UID}:${BACKUP_GID}" "$MOUNTPOINT"
    else
      echo "backup-usb-mount: ${DEVPATH} is LUKS-encrypted and locked, waiting for the passphrase" >&2
    fi
    ;;
  *)
    echo "backup-usb-mount: unsupported or unknown filesystem '${FSTYPE}' on ${DEVPATH}" >&2
    exit 1
    ;;
esac
