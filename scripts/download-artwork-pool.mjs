#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public", "artworks");
const DATA_DIR = path.join(ROOT, "src", "presets", "artworks");
const MANIFEST_PATH = path.join(PUBLIC_DIR, "manifest.json");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.generated.ts");

const requestedTargetPerBucket = Number(process.env.MURMUR_ARTWORKS_PER_BUCKET ?? 24);
const TARGET_PER_BUCKET =
  Number.isInteger(requestedTargetPerBucket) && requestedTargetPerBucket > 0
    ? requestedTargetPerBucket
    : 24;
const IMAGE_WIDTH = 1100;
const FETCH_TIMEOUT_MS = 30_000;

const BUCKETS = {
  luminist_air: {
    note: "Quiet air, distant water, pale weather; low-energy songs that need breath and interior distance.",
    energyRange: [0.2, 0.58],
    genreWeights: {
      "ambient electronic": 2.4,
      "solo piano": 2.2,
      "music box lullaby": 2,
      "guzheng meditation": 1.8,
      chillwave: 1.4,
      rain: 1.6,
    },
    moodWeights: {
      serene: 2.6,
      melancholic: 2,
      weightless: 2,
      dreamy: 1.5,
      glowing: 1.2,
    },
    queries: [
      ["met", "John Frederick Kensett coast"],
      ["met", "luminism landscape"],
      ["met", "Lake George Kensett"],
      ["met", "Martin Johnson Heade marsh"],
      ["aic", "Kensett coast"],
      ["aic", "Lake George landscape"],
      ["aic", "misty lake landscape"],
      ["aic", "tonalist landscape"],
    ],
  },
  sublime_terrain: {
    note: "Large terrain, mountain awe, sky pressure; melody framed as a small human signal in a huge world.",
    energyRange: [0.45, 0.95],
    genreWeights: {
      "cinematic film score": 2.6,
      "epic orchestral": 2.8,
      "post-rock": 2.4,
      bluegrass: 1.1,
      "psychedelic rock": 1.2,
    },
    moodWeights: {
      triumphant: 2.6,
      mysterious: 1.8,
      starlit: 1.8,
      brooding: 1.5,
    },
    queries: [
      ["met", "Albert Bierstadt mountains"],
      ["met", "Thomas Cole mountain landscape"],
      ["met", "Frederic Church landscape"],
      ["met", "Hudson River School mountains"],
      ["aic", "Bierstadt mountain"],
      ["aic", "Thomas Moran mountain"],
      ["aic", "mountain landscape public domain"],
      ["aic", "romantic landscape mountain"],
    ],
  },
  tidal_mineral: {
    note: "Water force, rock memory, coast geology; not beachy, more mineral and elemental.",
    energyRange: [0.32, 0.82],
    genreWeights: {
      "surf rock": 2.6,
      "reggae dub": 2,
      "bossa nova": 1.8,
      afrobeat: 1.4,
      "drum and bass": 1.1,
    },
    moodWeights: {
      glowing: 2,
      hypnotic: 1.7,
      serene: 1.5,
      euphoric: 1.2,
    },
    queries: [
      ["met", "Winslow Homer Bermuda"],
      ["met", "Winslow Homer seascape"],
      ["met", "coastal rocks watercolor"],
      ["aic", "Winslow Homer sea"],
      ["aic", "seascape rocks"],
      ["aic", "coast watercolor"],
      ["aic", "wave Japanese print Hokusai"],
      ["aic", "marine landscape public domain"],
    ],
  },
  pastoral_memory: {
    note: "Fields, dunes, small lakes, remembered weather; warmth without sentimentality.",
    energyRange: [0.25, 0.68],
    genreWeights: {
      "lo-fi hip hop": 1.8,
      "dream pop instrumental": 2,
      "celtic folk": 2,
      bluegrass: 2,
      "fingerpicked acoustic guitar": 1.2,
    },
    moodWeights: {
      nostalgic: 2.6,
      cozy: 2.3,
      bittersweet: 2,
      dreamy: 1.4,
    },
    queries: [
      ["met", "William Trost Richards landscape"],
      ["met", "pastoral landscape lake"],
      ["met", "George Inness landscape"],
      ["met", "sand dunes painting"],
      ["aic", "pastoral landscape"],
      ["aic", "dunes landscape"],
      ["aic", "George Inness"],
      ["aic", "rural landscape public domain"],
    ],
  },
  nocturne_metro: {
    note: "Wet city, night bridges, smoky interiors, reflected light; rain as modern weather.",
    energyRange: [0.35, 0.86],
    genreWeights: {
      "trip hop": 2.5,
      "deep house": 2.2,
      synthwave: 1.8,
      "city pop": 1.8,
      "UK garage": 1.6,
      tango: 1.3,
    },
    moodWeights: {
      smoky: 2.6,
      brooding: 2.1,
      melancholic: 1.8,
      starlit: 1.6,
      mysterious: 1.3,
    },
    queries: [
      ["aic", "Paris Street Rainy Day"],
      ["aic", "night city painting"],
      ["aic", "nocturne city"],
      ["aic", "Whistler nocturne"],
      ["met", "Whistler nocturne"],
      ["met", "night city painting"],
      ["met", "rainy street painting"],
      ["met", "urban nocturne"],
    ],
  },
  printed_signal: {
    note: "Lines, albums, diagrams, prints; music as a notated or divined signal.",
    energyRange: [0.2, 0.78],
    genreWeights: {
      "koto and shakuhachi": 2.8,
      "gamelan ensemble": 2,
      "guzheng meditation": 2.4,
      "baroque chamber strings": 1.7,
      "minimal techno": 1.5,
      vaporwave: 1.1,
    },
    moodWeights: {
      mysterious: 2.4,
      hypnotic: 2.2,
      serene: 1.7,
      playful: 1.1,
    },
    queries: [
      ["met", "Hokusai shashin gafu"],
      ["met", "Katsushika Hokusai landscape"],
      ["aic", "Hokusai shashin gafu"],
      ["aic", "Japanese woodblock landscape"],
      ["aic", "Utagawa Hiroshige rain"],
      ["met", "Hiroshige rain"],
      ["aic", "botanical print public domain"],
      ["met", "album leaf landscape"],
    ],
  },
  stage_heat: {
    note: "Theater, dance, crowd, lamps, rhythm in bodies; energetic without stock party gloss.",
    energyRange: [0.55, 0.98],
    genreWeights: {
      "funk groove": 2.4,
      disco: 2.7,
      "swing jazz": 2.3,
      "jazz fusion": 1.8,
      breakbeat: 1.5,
      "UK garage": 1.2,
      tango: 1.7,
    },
    moodWeights: {
      euphoric: 2.5,
      playful: 2.1,
      triumphant: 1.3,
      glowing: 1.1,
    },
    queries: [
      ["aic", "dance hall painting"],
      ["aic", "theater painting"],
      ["aic", "Degas dancers"],
      ["aic", "Toulouse Lautrec"],
      ["met", "Degas dancers"],
      ["met", "Toulouse Lautrec dance"],
      ["met", "jazz age dance"],
      ["aic", "cabaret public domain"],
    ],
  },
  interior_reverie: {
    note: "Rooms, windows, beds, tables, private weather; a small song held close.",
    energyRange: [0.2, 0.62],
    genreWeights: {
      "lo-fi hip hop": 2.6,
      "neo-soul": 1.8,
      "music box lullaby": 2.1,
      "solo piano": 2,
      "dream pop instrumental": 1.4,
      "city pop": 1.1,
    },
    moodWeights: {
      cozy: 2.6,
      nostalgic: 2.2,
      bittersweet: 2.1,
      smoky: 1.5,
      melancholic: 1.5,
    },
    queries: [
      ["aic", "interior window painting"],
      ["aic", "bedroom painting public domain"],
      ["aic", "woman reading interior"],
      ["aic", "Vuillard interior"],
      ["met", "interior window painting"],
      ["met", "woman reading interior"],
      ["met", "bedroom painting"],
      ["aic", "quiet interior painting"],
    ],
  },
  hypermodern_void: {
    note: "Clean abstraction, deep space, optical fields, strange purity; the future without sci-fi cliché.",
    energyRange: [0.35, 0.95],
    genreWeights: {
      synthwave: 2.5,
      "ambient electronic": 2.2,
      "minimal techno": 2.6,
      vaporwave: 2,
      chillwave: 1.5,
      "drum and bass": 1.4,
      breakbeat: 1.2,
    },
    moodWeights: {
      hypnotic: 2.5,
      weightless: 2.4,
      starlit: 2.2,
      mysterious: 1.5,
      euphoric: 1.1,
    },
    queries: [
      ["aic", "abstract painting public domain"],
      ["aic", "geometric abstraction public domain"],
      ["aic", "Arthur Dove abstract"],
      ["aic", "Marsden Hartley abstraction"],
      ["met", "Arthur Dove abstract"],
      ["met", "Marsden Hartley"],
      ["met", "abstract watercolor"],
      ["aic", "space abstract public domain"],
    ],
  },
};

const seenSourceKeys = new Set();

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "-")
    .slice(0, 84);
}

function hash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function clean(value, fallback = "Unknown") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function sourcePage(source, id) {
  if (source === "aic") return `https://www.artic.edu/artworks/${id}`;
  if (source === "met") return `https://www.metmuseum.org/art/collection/search/${id}`;
  return "";
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "MurmurArtworkCurator/1.0 (local development)",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  return response.json();
}

async function searchAic(query, limit = 18) {
  const url =
    `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}` +
    `&limit=${limit}&query[term][is_public_domain]=true` +
    "&fields=id,title,artist_title,artist_display,date_display,image_id,thumbnail,classification_titles,style_titles,subject_titles,term_titles,place_of_origin";
  const json = await fetchJson(url);
  return (json.data ?? [])
    .filter((item) => item.image_id)
    .map((item) => ({
      source: "aic",
      sourceId: String(item.id),
      title: clean(item.title),
      artist: clean(item.artist_title || item.artist_display),
      year: clean(item.date_display, ""),
      license: "CC0",
      imageUrl: `https://www.artic.edu/iiif/2/${item.image_id}/full/${IMAGE_WIDTH},/0/default.jpg`,
      sourceUrl: sourcePage("aic", item.id),
      sourceTags: [
        ...(item.classification_titles ?? []),
        ...(item.style_titles ?? []),
        ...(item.subject_titles ?? []),
        ...(item.term_titles ?? []),
        item.place_of_origin,
      ]
        .filter(Boolean)
        .map((tag) => String(tag).toLowerCase()),
    }));
}

async function searchMet(query, limit = 18) {
  const search = await fetchJson(
    `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(query)}`,
  );
  const ids = (search.objectIDs ?? []).slice(0, Math.max(limit * 2, 30));
  const out = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    try {
      const item = await fetchJson(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      );
      if (!item.isPublicDomain || !item.primaryImageSmall) continue;
      out.push({
        source: "met",
        sourceId: String(item.objectID),
        title: clean(item.title),
        artist: clean(item.artistDisplayName || item.culture),
        year: clean(item.objectDate, ""),
        license: "Public Domain",
        imageUrl: item.primaryImage || item.primaryImageSmall,
        sourceUrl: item.objectURL || sourcePage("met", item.objectID),
        sourceTags: [
          item.classification,
          item.medium,
          item.department,
          item.period,
          item.objectName,
          ...(item.tags?.map((tag) => tag.term) ?? []),
        ]
          .filter(Boolean)
          .map((tag) => String(tag).toLowerCase()),
      });
    } catch (error) {
      console.warn("[met] skip", id, error.message);
    }
  }
  return out;
}

async function searchProvider(provider, query) {
  if (provider === "aic") return searchAic(query);
  if (provider === "met") return searchMet(query);
  throw new Error(`Unknown provider ${provider}`);
}

function candidateQuality(candidate, bucket, bucketSpec) {
  const haystack = [
    candidate.title,
    candidate.artist,
    candidate.year,
    ...candidate.sourceTags,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;

  const positive = {
    luminist_air: ["landscape", "lake", "coast", "water", "mist", "moon", "tonal", "kensett", "heade", "inness"],
    sublime_terrain: ["mountain", "rock", "valley", "wilderness", "landscape", "bierstadt", "church", "moran", "cole"],
    tidal_mineral: ["sea", "coast", "shore", "wave", "water", "homer", "marine", "rock", "bermuda"],
    pastoral_memory: ["pastoral", "field", "dune", "lake", "landscape", "inness", "richards", "farm", "meadow"],
    nocturne_metro: ["nocturne", "night", "city", "street", "rain", "bridge", "whistler", "urban", "paris"],
    printed_signal: ["print", "woodblock", "hokusai", "hiroshige", "album", "illustrated", "japan", "botanical"],
    stage_heat: ["dance", "dancer", "theater", "stage", "cabaret", "music", "degas", "lautrec", "poster"],
    interior_reverie: ["interior", "room", "window", "bedroom", "reading", "woman", "domestic", "vuillard"],
    hypermodern_void: ["abstract", "composition", "geometric", "dove", "hartley", "watercolor", "modern"],
  }[bucket] ?? [];

  for (const word of positive) if (haystack.includes(word)) score += 2.2;
  for (const tag of Object.keys(bucketSpec.genreWeights)) if (haystack.includes(tag)) score += 0.4;

  const negative = [
    "weapon",
    "armor",
    "coin",
    "vase",
    "bowl",
    "fragment",
    "photograph",
    "negative",
    "daguerreotype",
    "portrait",
    "head",
    "bust",
    "saint",
    "christ",
    "crucifixion",
    "execution",
    "battle",
    "war",
    "plate",
    "textile",
    "chair",
    "table clock",
  ];
  for (const word of negative) if (haystack.includes(word)) score -= 4;

  if (candidate.title.length < 4 || candidate.artist === "Unknown") score -= 1.5;
  if (candidate.source === "aic") score += 0.2;
  return score;
}

function makeEntry(candidate, bucket, bucketSpec, index) {
  const sourceKey = `${candidate.source}:${candidate.sourceId}`;
  const id = `${bucket}-${candidate.source}-${candidate.sourceId}`;
  const filename = `${String(index + 1).padStart(3, "0")}-${slugify(candidate.artist)}-${slugify(candidate.title)}-${hash(sourceKey)}.jpg`;
  const imagePath = `/artworks/${bucket}/${filename}`;
  return {
    id,
    bucket,
    title: candidate.title,
    artist: candidate.artist,
    year: candidate.year,
    source: candidate.source,
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
    imagePath,
    license: candidate.license,
    tags: Array.from(
      new Set([
        bucket,
        ...Object.keys(bucketSpec.genreWeights),
        ...Object.keys(bucketSpec.moodWeights),
        ...candidate.sourceTags.slice(0, 10),
      ]),
    ),
    genreWeights: bucketSpec.genreWeights,
    moodWeights: bucketSpec.moodWeights,
    energyRange: bucketSpec.energyRange,
    crop: { x: 0.5, y: 0.5, scale: 1 },
    curatorNote: bucketSpec.note,
    downloadUrl: candidate.imageUrl,
    filename,
  };
}

async function downloadFile(url, filePath) {
  const response = await fetchWithTimeout(url);
  if (!response.body) throw new Error(`Missing response body: ${url}`);
  await pipeline(response.body, createWriteStream(filePath));
}

async function collectBucket(bucket, bucketSpec) {
  const candidates = [];
  for (const [provider, query] of bucketSpec.queries) {
    console.log(`[search] ${bucket} :: ${provider} :: ${query}`);
    try {
      const items = await searchProvider(provider, query);
      for (const item of items) {
        const sourceKey = `${item.source}:${item.sourceId}`;
        if (seenSourceKeys.has(sourceKey)) continue;
        const quality = candidateQuality(item, bucket, bucketSpec);
        if (quality < 1.8) continue;
        candidates.push({ ...item, quality });
      }
    } catch (error) {
      console.warn(`[search] failed ${provider} ${query}:`, error.message);
    }
  }

  candidates.sort((a, b) => b.quality - a.quality);
  const picked = [];
  for (const candidate of candidates) {
    if (picked.length >= TARGET_PER_BUCKET) break;
    const sourceKey = `${candidate.source}:${candidate.sourceId}`;
    if (seenSourceKeys.has(sourceKey)) continue;
    seenSourceKeys.add(sourceKey);
    picked.push(candidate);
  }
  return picked.map((candidate, index) => makeEntry(candidate, bucket, bucketSpec, index));
}

function publicEntry(entry) {
  const cleanEntry = { ...entry };
  delete cleanEntry.downloadUrl;
  delete cleanEntry.filename;
  return cleanEntry;
}

function catalogTs(entries) {
  const cleanEntries = entries.map(publicEntry);
  return `import type { ArtworkCatalogEntry } from "./types";\n\nexport const ARTWORK_CATALOG = ${JSON.stringify(cleanEntries, null, 2)} as const satisfies readonly ArtworkCatalogEntry[];\n`;
}

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const entries = [];
  for (const [bucket, bucketSpec] of Object.entries(BUCKETS)) {
    const bucketDir = path.join(PUBLIC_DIR, bucket);
    await mkdir(bucketDir, { recursive: true });
    const bucketEntries = await collectBucket(bucket, bucketSpec);
    console.log(`[bucket] ${bucket}: picked ${bucketEntries.length}/${TARGET_PER_BUCKET}`);
    for (const entry of bucketEntries) {
      const filePath = path.join(bucketDir, entry.filename);
      try {
        await downloadFile(entry.downloadUrl, filePath);
        entries.push(entry);
      } catch (error) {
        console.warn(`[download] failed ${entry.id}:`, error.message);
      }
    }
  }

  entries.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.id.localeCompare(b.id));
  await writeFile(MANIFEST_PATH, JSON.stringify(entries.map(publicEntry), null, 2));
  await writeFile(CATALOG_PATH, catalogTs(entries));

  const counts = entries.reduce((acc, entry) => {
    acc[entry.bucket] = (acc[entry.bucket] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ total: entries.length, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
