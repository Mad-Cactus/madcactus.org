-- Raise per-object size limit on portal-docs bucket (was NULL → 50MiB default).
-- Meeting audio uploads exceeded the default. 150 MiB covers ~3.5h of 128kbps
-- compressed audio. Bump if larger sources (uncompressed WAV) appear.
update storage.buckets
   set file_size_limit = 157286400   -- 150 MiB, in bytes
 where id = 'portal-docs';
