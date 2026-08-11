#!/usr/bin/env bash
set -euo pipefail

# Mounts the external USB backup drive at a stable path so pwa-admin can
# detect and write to it without ever calling mount/umount itself. Triggered
# by /etc/udev/rules.d/99-backup-usb.rules on hotplug (works headless — no
# desktop session/polkit agent required, unlike udisks2 auto-mount).

DEVNAME="$1"  # e.g. sda1, from udev's %k
DEVPATH="/dev/${DEVNAME}"
MOUNTPOINT="/media/backup-usb"
# Substituted by install.sh at install time with the pwa-admin service
# account's real uid/gid (`id -u`/`id -g`) — a dedicated system account does
# NOT get uid/gid 1000 (that's the conventional first-human-user id on
# Debian/Ubuntu), so a literal 1000 here would mount the drive owned by the
# wrong account and the service couldn't write to it.
BACKUP_UID=__PWA_ADMIN_UID__
BACKUP_GID=__PWA_ADMIN_GID__

mkdir -p "$MOUNTPOINT"

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
  *)
    echo "backup-usb-mount: unsupported or unknown filesystem '${FSTYPE}' on ${DEVPATH}" >&2
    exit 1
    ;;
esac
