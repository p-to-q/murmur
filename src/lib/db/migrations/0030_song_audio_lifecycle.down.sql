DROP TRIGGER IF EXISTS "songs_audio_lifecycle_trg" ON "songs";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "murmur_track_legacy_song_audio"();
--> statement-breakpoint
DROP TABLE IF EXISTS "song_audio_objects";
