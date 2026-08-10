#!/usr/bin/env bash
set -euo pipefail

# Mounts the external USB backup drive at a stable path so pwa-admin can
# detect and write to it without ever calling mount/umount itself. Triggered
# by /etc/udev/rules.d/99-backup-usb.rules on hotplug (works headless — no
# desktop session/polkit agent required, unlike udisks2 auto-mount).

DEVNAME="$1"  # e.g. sda1, from udev's %k
DEVPATH="/dev/${DEVNAME}"
MOUNTPOINT="/media/backup-usb"
BACKUP_UID=1000
BACKUP_GID=1000

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
