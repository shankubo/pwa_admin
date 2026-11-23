#!/usr/bin/env bash
set -euo pipefail

# Root-side helper behind the "encrypt the USB backup drive (LUKS)" feature of
# pwa-admin. The service never runs as root, so every privileged step lives in
# this single script, reachable through ONE scoped sudoers rule. Because that
# rule has to allow arbitrary arguments, this script re-validates everything
# itself: the target must be a partition of a USB-attached disk that is not a
# system mount. Passphrases arrive on stdin only (never argv, so they never
# show up in `ps` or audit logs) and are never written to disk.
#
#   backup-usb-luks.sh unlock          <partition>
#   backup-usb-luks.sh format          <partition> [--with-keyfile]   (ERASES the partition)
#   backup-usb-luks.sh enable-keyfile  <partition>
#   backup-usb-luks.sh disable-keyfile <partition>
#   backup-usb-luks.sh status          <partition>                    (no stdin needed)

MAPPER="backup-usb-crypt"
MOUNTPOINT="/media/backup-usb"
KEYFILE_DIR="/etc/pwa-admin"
KEYFILE="${KEYFILE_DIR}/usb-luks.key"
# Substituted by install.sh with the pwa-admin service account's real ids.
BACKUP_UID=__PWA_ADMIN_UID__
BACKUP_GID=__PWA_ADMIN_GID__

die() { echo "backup-usb-luks: $*" >&2; exit 1; }

ACTION="${1:-}"
PART="${2:-}"
shift 2 2>/dev/null || true
WITH_KEYFILE=0
for arg in "$@"; do
  case "$arg" in
    --with-keyfile) WITH_KEYFILE=1 ;;
    *) die "unknown_option" ;;
  esac
done

[[ "$PART" =~ ^(sd[a-z]+[0-9]+|nvme[0-9]+n[0-9]+p[0-9]+|mmcblk[0-9]+p[0-9]+)$ ]] || die "invalid_partition_name"
DEV="/dev/${PART}"
[ -b "$DEV" ] || die "not_a_block_device"

# Same signal the udev rule uses: a USB bridge reports ID_BUS=usb, a UAS
# enclosure reports ID_BUS=scsi plus a non-empty ID_USB_DRIVER.
PROPS="$(udevadm info -q property -n "$DEV")"
if ! grep -qE '^ID_BUS=usb$|^ID_USB_DRIVER=.+' <<<"$PROPS"; then
  die "not_a_usb_device"
fi

for sys in / /boot /boot/firmware; do
  if findmnt -rn -S "$DEV" -o TARGET | grep -qx "$sys"; then die "system_partition_refused"; fi
done

PASS=""
read_passphrase() {
  # --key-file=- reads stdin to EOF without stripping a newline, so the
  # passphrase must be handled byte-for-byte identically at every step.
  IFS= read -r -d '' PASS || true
  [ "${#PASS}" -ge 8 ] || die "passphrase_too_short"
}
with_pass() { printf '%s' "$PASS" | "$@"; }

mapper_open() { [ -e "/dev/mapper/${MAPPER}" ]; }

# Mounting here happens outside the systemd unit, so the unit would stay
# inactive and "systemctl stop" (eject) would then do nothing. Starting it
# afterwards is safe: its ExecStart sees the drive already mounted and exits.
align_unit() { systemctl start "backup-usb-mount@${PART}.service" 2>/dev/null || true; }

# A mapping left behind by a drive that was unplugged without eject still
# "exists" but its backing disk is gone: treating it as open would make unlock
# mount a dead device. Drop it so the next open starts from a clean state.
clear_stale_mapper() {
  mapper_open || return 0
  local backing
  backing="$(cryptsetup status "$MAPPER" 2>/dev/null | awk '/^ *device:/{print $2}' || true)"
  if [ -z "$backing" ] || [ ! -b "$backing" ]; then
    umount -l "$MOUNTPOINT" 2>/dev/null || true
    cryptsetup close "$MAPPER" 2>/dev/null || dmsetup remove --force "$MAPPER" 2>/dev/null || true
  fi
}

mount_mapper() {
  mkdir -p "$MOUNTPOINT"
  mountpoint -q "$MOUNTPOINT" && return 0
  local fstype
  # A mapper that was just created or formatted isn't in udev's cache yet, and
  # lsblk reads that cache: it reported "no filesystem" right after a successful
  # mkfs. Wait for udev, then probe the device directly (blkid -p) instead.
  udevadm settle --timeout=10 2>/dev/null || true
  fstype="$(blkid -p -s TYPE -o value "/dev/mapper/${MAPPER}" 2>/dev/null || true)"
  [ -n "$fstype" ] || fstype="$(lsblk -no FSTYPE "/dev/mapper/${MAPPER}")"
  case "$fstype" in
    ext4|ext3|ext2|xfs|btrfs)
      mount "/dev/mapper/${MAPPER}" "$MOUNTPOINT"
      chown "${BACKUP_UID}:${BACKUP_GID}" "$MOUNTPOINT"
      ;;
    *) cryptsetup close "$MAPPER" || true; die "unsupported_inner_filesystem:${fstype:-none}" ;;
  esac
}

require_luks() { cryptsetup isLuks "$DEV" || die "not_a_luks_partition"; }

case "$ACTION" in
  unlock)
    require_luks
    read_passphrase
    clear_stale_mapper
    if mapper_open; then
      mount_mapper
      align_unit
      exit 0
    fi
    with_pass cryptsetup open --type luks --key-file=- "$DEV" "$MAPPER" || die "wrong_passphrase"
    mount_mapper
    align_unit
    ;;

  eject)
    # Works whether or not the mount unit is active (e.g. after an unlock done
    # from the app), and falls back to lazy/forced teardown so an eject never
    # silently leaves the drive mounted.
    sync
    systemctl stop "backup-usb-mount@${PART}.service" 2>/dev/null || true
    if mountpoint -q "$MOUNTPOINT"; then
      umount "$MOUNTPOINT" 2>/dev/null || umount -l "$MOUNTPOINT" || die "unmount_failed"
    fi
    if mapper_open; then
      cryptsetup close "$MAPPER" 2>/dev/null || dmsetup remove --force "$MAPPER" || die "mapper_busy"
    fi
    ;;

  format)
    read_passphrase
    # Never format something still in use: release it through the same unit the
    # app uses for ejecting, then make sure nothing is left mounted.
    systemctl stop "backup-usb-mount@${PART}.service" 2>/dev/null || true
    clear_stale_mapper
    if mapper_open; then umount "$MOUNTPOINT" 2>/dev/null || true; cryptsetup close "$MAPPER" || die "mapper_busy"; fi
    if findmnt -rn -S "$DEV" >/dev/null; then die "partition_still_mounted"; fi
    if lsblk -rno MOUNTPOINT "$DEV" | grep -q .; then die "partition_still_mounted"; fi

    # A USB drive can drop off the bus mid-format (seen with UAS on a Samsung
    # T7). Name the failing step, say so explicitly when the disk vanished, and
    # never leave a dead dm-crypt mapping behind: a stale mapper makes the next
    # attempt think the drive is already open.
    FORMAT_OK=0
    OPENED_BY_US=0
    cleanup_failed_format() {
      [ "$FORMAT_OK" -eq 1 ] && return 0
      umount "$MOUNTPOINT" 2>/dev/null || true
      if [ "$OPENED_BY_US" -eq 1 ] && mapper_open; then
        cryptsetup close "$MAPPER" 2>/dev/null || dmsetup remove --force "$MAPPER" 2>/dev/null || true
      fi
    }
    trap cleanup_failed_format EXIT

    step() {
      local code="$1"; shift
      [ -b "$DEV" ] || die "device_disconnected"
      "$@" || { [ -b "$DEV" ] || die "device_disconnected"; die "$code"; }
    }

    step luks_format_failed with_pass cryptsetup luksFormat --type luks2 --batch-mode --key-file=- "$DEV"
    step luks_open_failed with_pass cryptsetup open --type luks --key-file=- "$DEV" "$MAPPER"
    OPENED_BY_US=1
    # lazy_*_init defer most of the inode-table/journal zeroing to the kernel's
    # background thread, so formatting a 1 TB disk is a short burst instead of a
    # sustained write over the whole device.
    step mkfs_failed mkfs.ext4 -F -q -L BACKUP -E lazy_itable_init=1,lazy_journal_init=1 "/dev/mapper/${MAPPER}"
    sync
    mount_mapper
    align_unit
    if [ "$WITH_KEYFILE" -eq 1 ]; then
      with_pass "$0" enable-keyfile "$PART" >/dev/null || echo "backup-usb-luks: keyfile_setup_failed" >&2
    fi
    FORMAT_OK=1
    ;;

  enable-keyfile)
    require_luks
    if [ ! -f "$KEYFILE" ]; then
      NEW_KEYFILE=1
      mkdir -p "$KEYFILE_DIR"; chmod 700 "$KEYFILE_DIR"
      ( umask 077; head -c 64 /dev/urandom > "$KEYFILE" )
      chmod 400 "$KEYFILE"
    else
      NEW_KEYFILE=0
    fi
    if cryptsetup open --test-passphrase --key-file "$KEYFILE" "$DEV" 2>/dev/null; then
      echo "keyfile=yes"; exit 0
    fi
    read_passphrase
    if ! with_pass cryptsetup luksAddKey --key-file=- "$DEV" "$KEYFILE"; then
      [ "$NEW_KEYFILE" -eq 1 ] && rm -f "$KEYFILE"
      die "wrong_passphrase"
    fi
    echo "keyfile=yes"
    ;;

  disable-keyfile)
    require_luks
    read_passphrase
    # Prove the admin's passphrase still opens the device BEFORE dropping the
    # keyfile slot, so this can never leave the drive with no usable key.
    with_pass cryptsetup open --test-passphrase --key-file=- "$DEV" || die "wrong_passphrase"
    if [ -f "$KEYFILE" ] && cryptsetup open --test-passphrase --key-file "$KEYFILE" "$DEV" 2>/dev/null; then
      cryptsetup luksRemoveKey "$DEV" "$KEYFILE" || die "keyslot_removal_failed"
    fi
    rm -f "$KEYFILE"
    echo "keyfile=no"
    ;;

  status)
    require_luks
    if [ -f "$KEYFILE" ] && cryptsetup open --test-passphrase --key-file "$KEYFILE" "$DEV" 2>/dev/null; then
      echo "keyfile=yes"
    else
      echo "keyfile=no"
    fi
    ;;

  *) die "unknown_action" ;;
esac
