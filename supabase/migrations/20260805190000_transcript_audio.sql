-- Link optional audio files to transcript documents
alter table documents
    add column if not exists audio_path text,
    add column if not exists audio_file_name text;
