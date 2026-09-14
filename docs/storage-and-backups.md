# Clovis Star Storage and Backups

Clovis Star is designed to use PostgreSQL as the future source-of-truth database, with local server storage for uploaded documents and media until an object-storage provider is added.

## Local Upload Storage

Configured variables:

```env
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=/var/www/clovisstar/storage/uploads
PUBLIC_FILE_BASE_URL=https://clovisstar.com/uploads
MAX_UPLOAD_SIZE_MB=100
```

Files are stored by date and content type:

```text
/var/www/clovisstar/storage/uploads/2026/06/books/
/var/www/clovisstar/storage/uploads/2026/06/tablets/
/var/www/clovisstar/storage/uploads/2026/06/manuscripts/
/var/www/clovisstar/storage/uploads/2026/06/images/
/var/www/clovisstar/storage/uploads/2026/06/pdf/
```

The app validates MIME type and size, creates a safe stored filename, calculates a SHA-256 hash, writes the file locally, and records metadata in `file_assets`.

## PostgreSQL Backup

When `DATABASE_URL` is configured, back up PostgreSQL with:

```bash
pg_dump "$DATABASE_URL" > /home/clovisstar/backups/clovisstar-postgres-$(date +%Y%m%d-%H%M%S).sql
```

Restore with:

```bash
psql "$DATABASE_URL" < /home/clovisstar/backups/clovisstar-postgres-YYYYMMDD-HHMMSS.sql
```

## Local Upload Backup

Create a compressed upload backup:

```bash
tar -C /var/www/clovisstar/storage -czf /home/clovisstar/backups/clovisstar-uploads-$(date +%Y%m%d-%H%M%S).tar.gz uploads
```

Restore uploads:

```bash
mkdir -p /var/www/clovisstar/storage
tar -C /var/www/clovisstar/storage -xzf /home/clovisstar/backups/clovisstar-uploads-YYYYMMDD-HHMMSS.tar.gz
```

## Cron Backup Example

```cron
15 2 * * * pg_dump "$DATABASE_URL" > /home/clovisstar/backups/clovisstar-postgres-$(date +\%Y\%m\%d-\%H\%M\%S).sql
30 2 * * * tar -C /var/www/clovisstar/storage -czf /home/clovisstar/backups/clovisstar-uploads-$(date +\%Y\%m\%d-\%H\%M\%S).tar.gz uploads
```

## Moving to S3, R2, Wasabi, or Backblaze Later

The app calls a common storage service. To migrate later:

1. Add a new storage driver implementing `save`, `delete`, `getPublicUrl`, `exists`, and `status`.
2. Copy local files to the new bucket.
3. Update existing `file_assets.public_url` and driver metadata.
4. Change `STORAGE_DRIVER` to the new driver.
5. Verify `/health`, public file URLs, admin file metadata, and backups.

Do not delete local uploads until the new bucket has been verified and backed up.

