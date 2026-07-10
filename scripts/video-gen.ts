#!/usr/bin/env bun
/**
 * Murmur Product Video — AI Generation Pipeline
 *
 * Workflow: GPT-Image-2 (seed frames) → Kling O3 i2v (video clips)
 * Fallback draft: 即梦 3.0 (cheaper, for quick iteration)
 *
 * Usage:
 *   bun run scripts/video-gen.ts seed --scene 03        # generate seed frame for scene 03
 *   bun run scripts/video-gen.ts seed --all              # generate all seed frames
 *   bun run scripts/video-gen.ts video --scene 03        # generate video from seed frame
 *   bun run scripts/video-gen.ts video --scene 03 --draft # use 即梦 3.0 (cheaper draft)
 *   bun run scripts/video-gen.ts status --task <id>      # check task status
 *   bun run scripts/video-gen.ts download --url <url> --scene <id>  # download completed video
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Config ──────────────────────────────────────────────────────────────────

const _scriptFile = fileURLToPath(import.meta.url);
const _scriptDir = dirname(_scriptFile);

const API_KEY = process.env.VIDEO_GEN_API_KEY;
if (!API_KEY) {
  console.error("ERROR: VIDEO_GEN_API_KEY environment variable is required");
  console.error("Set it via: export VIDEO_GEN_API_KEY=sk-...");
  process.exit(1);
}
const API_BASE = "https://api.302.ai";
const ASSETS_DIR = join(_scriptDir, "..", "docs", "video-assets");
const SEEDS_DIR = join(ASSETS_DIR, "seeds");
const CLIPS_DIR = join(ASSETS_DIR, "clips");
const DRAFTS_DIR = join(ASSETS_DIR, "drafts");
const TASKS_DIR = join(ASSETS_DIR, ".tasks");  // store task metadata

// Ensure directories exist
for (const dir of [SEEDS_DIR, CLIPS_DIR, DRAFTS_DIR, TASKS_DIR]) {
  mkdirSync(dir, { recursive: true });
}

// ─── Style Block (appended to every prompt) ──────────────────────────────────

const STYLE_BLOCK = `Cinematic photorealistic, Kodak Vision3 250D film stock, warm highlight roll-off into soft amber, shadows retain detail with muted teal-gray undertone. Subtle organic film grain visible on skin and flat surfaces — not digital noise, analog texture. Shallow depth of field f/1.8, foreground and background naturally separate into bokeh layers. Color palette globally muted with selective warm accents (amber, honey, aged brass). Skin tones natural and untouched — slight imperfections visible. 16:9 aspect ratio. No text, no watermark, no UI, no logos. Lighting motivated by practical sources within the scene (lamps, windows, screens, streetlights) — no unmotivated studio lighting. Atmosphere includes subtle environmental particles (dust in light beams, moisture in air, steam). Overall mood: the quiet weight of an unspoken melody.`;

const STYLE_BLOCK_WITH_TEXT = `Cinematic photorealistic, Kodak Vision3 250D film stock, warm highlight roll-off into soft amber, shadows retain detail with muted teal-gray undertone. Subtle organic film grain visible on skin and flat surfaces — not digital noise, analog texture. Shallow depth of field f/1.8, foreground and background naturally separate into bokeh layers. Color palette globally muted with selective warm accents (amber, honey, aged brass). 16:9 aspect ratio. No watermark, no UI, no logos. Lighting motivated by practical sources within the scene (lamps, windows, screens, streetlights) — no unmotivated studio lighting. Atmosphere includes subtle environmental particles (dust in light beams, moisture in air, steam). Overall mood: the quiet weight of an unspoken melody.`;

function resolveStyle(scene: SceneConfig): string {
  return scene.styleBlock ?? STYLE_BLOCK;
}

// ─── Scene Definitions ───────────────────────────────────────────────────────

interface SceneConfig {
  id: string;
  name: string;
  duration: number;       // seconds for video generation (5 or 10)
  clipDuration: number;   // actual clip duration in final edit
  prompt: string;         // full 7-layer prompt for seed frame
  videoPrompt: string;    // motion/action description for i2v
  negativePrompt: string; // --no items
  styleBlock?: string;    // overrides DEFAULT_STYLE_BLOCK (e.g. when scene needs text)
  isCodeAnim?: boolean;   // Scene 09, 11-B: skip AI generation
}

const SCENES: SceneConfig[] = [
  {
    id: "01",
    name: "水的旋律",
    duration: 5,
    clipDuration: 4,
    prompt: `Extreme close-up, 100mm macro lens, f/2.8. Center-symmetrical composition. Glass kettle occupies dead center of frame, background dissolves into uniform warm bokeh. Water inside a glass kettle just beginning to simmer — tiny bubbles rising from the bottom in rhythmic clusters, caught in the exact mid-state of breaking at the surface. Not the start of boiling, not a full boil — the liminal moment between stillness and activity. Condensation droplets on the inner glass wall, slightly fogged. The kettle handle shows faint water stains and wear marks — this is a used object, not a product shot. A single bubble, larger than the rest, is mid-deformation as it reaches the surface. Early morning side light entering from a window at camera-left, cold blue-white. The gas flame beneath casts a faint warm amber uplight on the bottom curve of the glass. Two competing color temperatures: cool daylight above, warm fire below. Dust motes visible in the light beam crossing through frame. Highlights: pale blue-white. Shadows: slate gray with cool green undertone. Single warm accent: the flame glow. ${STYLE_BLOCK}`,
    videoPrompt: "Completely static camera for 3 seconds then imperceptibly slow push-in. Tiny bubbles rise rhythmically from the bottom of the glass kettle, breaking gently at the water surface. Condensation slowly forms on the inner glass wall. Dust motes drift lazily through the light beam. The gas flame flickers subtly beneath.",
    negativePrompt: "steam cloud, whistling, bright colors, people, hands, text, modern kitchen appliances in background, overhead lighting"
  },
  {
    id: "02",
    name: "灰色世界里的暖色信号",
    duration: 5,
    clipDuration: 4,
    prompt: `Overhead bird's-eye view, 35mm wide lens, static camera mounted directly above. Pure geometric composition from directly above. Crosswalk white stripes create horizontal rhythm. Pedestrian shadows radiate at diagonal angles forming an evolving pattern — the ground is a canvas being drawn on by moving bodies. 8-10 pedestrians crossing in various directions. All wearing muted gray, charcoal, dark navy — urban winter palette. One person, positioned at the golden ratio point of the frame, wears an amber-colored wool coat that becomes the single warm signal in a cold field. We see only the tops of heads and shoulders — no faces, identity dissolved into pattern. Concrete surface shows authentic wear: hairline cracks, old gum stains darkened by weather, a faded yellow lane marking partially repainted. The amber-coated person carries a canvas tote bag. Overcast morning light — soft, directionless, even. Shadows are long but diffused. Dominant: concrete gray and asphalt charcoal. Shadows: cool blue-gray. Single accent: amber coat. ${STYLE_BLOCK}`,
    videoPrompt: "Static overhead camera. Pedestrians walk in various directions across the crosswalk, their long shadows forming evolving geometric patterns on the concrete. The amber-coated person moves at the golden ratio point. Playback feels slightly dreamlike, subtly faster than real-time. All movement is natural human walking pace.",
    negativePrompt: "cars, traffic lights in frame, rain, puddles, bright signage, visible faces, sunny day, sharp shadows"
  },
  {
    id: "03",
    name: "有人在哼歌",
    duration: 5,
    clipDuration: 5,
    prompt: `Medium shot, 85mm portrait lens, f/1.8. Rule-of-thirds: subject in left third of frame. Right two-thirds filled with the window and defocused city beyond. A large monstera leaf enters frame from the lower-right foreground, heavily blurred at f/1.8, creating a translucent green curtain between camera and subject — Wong Kar-wai voyeuristic intimacy. A young person, 25-30, gender-ambiguous, sitting sideways at a wooden table by a floor-to-ceiling window. Profile view. They are humming unconsciously: lips barely parting and closing in micro-movements, not performing a song, caught in the involuntary act of a melody escaping. Left hand rests on the table, index and middle fingers tapping an irregular rhythm. Posture relaxed, slightly slouched. Amber tea in a thin glass cup — half-finished, tea stain ring on the table. Soft oversized linen shirt, slightly wrinkled at the elbows. One earbud in, the other dangles. Hair slightly messy, morning state. Soft morning window light on window-side half of face, other half in gentle shadow. Warm-toned table lamp creates secondary warm source on tea cup and table. ${STYLE_BLOCK}`,
    videoPrompt: "Extremely slow dolly-in over 5 seconds — so gradual the viewer feels drawn closer without realizing the camera moved. The person's lips barely part and close in micro-movements, humming unconsciously. Their fingers tap an irregular rhythm on the wooden table, slightly out of sync with the lip movement. The monstera leaf in foreground sways almost imperceptibly. Steam from the tea cup rises in a thin thread.",
    negativePrompt: "direct eye contact, smiling, singing with open mouth, headphones, bright room, overhead lighting, clean minimalist interior, perfect hair"
  },
  {
    id: "04",
    name: "Everyone hums.",
    duration: 5,
    clipDuration: 2,
    styleBlock: STYLE_BLOCK_WITH_TEXT,
    prompt: `Medium-close shot, 50mm lens, f/4. Center-symmetrical. The wall fills the entire frame edge to edge — no sky, no ground. An aged concrete wall. On it, handwritten in black marker: "Everyone hums." — the handwriting is casual, slightly tilted, one letter shows ink bleeding where the marker paused. The writing looks like it has been there for weeks. Wall surface: fine hairline cracks forming organic web pattern. A water stain from the upper-left corner — dried, amber-edged. Traces of previous layer of paint (pale sage green) visible where gray surface has chipped. A single small weed sprouts from a crack near bottom of frame. Wall color close to #F5F1EB. Flat, overcast daylight. Monochrome warm gray. ${STYLE_BLOCK_WITH_TEXT}`,
    videoPrompt: "Completely static camera, 2 seconds. The only movement is barely perceptible: the tiny weed at the bottom sways in a breath of wind. Light shifts imperceptibly as a cloud passes. The wall breathes with micro-changes in shadow.",
    negativePrompt: "people, graffiti art, colorful paint, posters, visible street or sky, perfect wall, clean surface, stencil lettering, neon, any text other than Everyone hums"
  },
  {
    id: "05A",
    name: "深夜便利店",
    duration: 5,
    clipDuration: 2.25,
    prompt: `Medium shot, 35mm lens, f/2, static camera. Shot from OUTSIDE the store looking IN through glass door. Rule-of-thirds: person in right-third. The glass door surface simultaneously transmits warm interior light AND reflects cool exterior streetscape, creating a double-exposure effect. Foreground obstruction: condensation mist along lower edge. One person standing with their back to camera in front of convenience store shelf, shoulders barely swaying in micro-rhythm. They hold a triangular rice ball in one hand, paused mid-bite. Through glass: fluorescent tubes cast even white light on colorful product rows. On glass surface: condensation mist in lower 20%, fingerprint smudges, small sticker. Reflected: cool blue-purple glow of pharmacy cross sign. Three competing light sources: warm amber streetlight from behind-camera, cool white fluorescent from inside, colored neon reflections on glass. ${STYLE_BLOCK}`,
    videoPrompt: "Static camera looking through glass. The person's shoulders sway in barely perceptible micro-rhythm. Condensation on glass shifts subtly. Neon reflections on the glass surface slowly drift as if a vehicle passed outside. The fluorescent tubes inside have an almost imperceptible flicker.",
    negativePrompt: "face visible, bright interior, crowded store, daylight, clean glass without condensation, camera inside the store"
  },
  {
    id: "05B",
    name: "黄昏公路",
    duration: 5,
    clipDuration: 2.25,
    prompt: `Interior car POV from passenger seat, 24mm wide lens, f/2, static camera mounted on dashboard. Three depth layers: foreground — steering wheel silhouette and dashboard creating dark frame at bottom third, midground — driver's left hand on wheel, fingers mid-tap, background — empty highway stretching to vanishing point, horizon line extremely low. Sky dominates. Driver's hand — only the hand and forearm visible, dark linen shirt sleeve pushed to elbow. Fingers in mid-state of rhythmic tap: index finger lifted 2cm off wheel. Dashboard instruments emit warm amber glow. Through windshield: highway surface has heat shimmer distortion. Single dead insect on windshield. Rearview mirror catches fading sky. Golden hour — sun at horizon directly ahead, warm wash across dashboard. Sky gradients from deep amber through warm peach to high blue-gray. Subtle anamorphic lens flare. ${STYLE_BLOCK}`,
    videoPrompt: "Static dashboard-mounted camera with slight natural vibration from the car moving. The driver's fingers tap rhythmically on the steering wheel — a gentle, unconscious gesture. Heat shimmer distorts the distant highway. The sun slowly descends at the horizon, lens flare stretches horizontally. The landscape drifts past very slowly.",
    negativePrompt: "other cars, traffic, rain, city, bright interior light, visible face, night, headlights on"
  },
  {
    id: "05C",
    name: "雨窗",
    duration: 5,
    clipDuration: 2.25,
    prompt: `Extreme macro, 100mm macro lens, f/2.8, static camera. Abstract — no horizon, no identifiable space. Window glass fills frame completely. Raindrops on glass — hundreds of small droplets clinging to the surface. City lights behind glass in full defocus, creating large circular bokeh orbs of amber, white, and pale blue. A single human finger enters from the left frame edge, drawing a deliberate line through condensation. Where finger passes, droplets merge and flow downward, reorganizing from scattered chaos into flowing stream. Each raindrop refracts city lights. Finger shows realistic texture — visible fingerprint whorl, slightly pruned from moisture. All illumination from bokeh city lights behind glass. Cool dominant with warm bokeh accents. ${STYLE_BLOCK}`,
    videoPrompt: "Static macro camera on the window glass. A finger slowly enters from the left edge and draws a deliberate line through the condensation. Raindrops merge and flow along the traced path. Bokeh lights behind the glass shift subtly as cars pass outside. New tiny droplets slowly form on the clear glass surface.",
    negativePrompt: "full hand visible, face reflection, clear view through window, daylight, dry glass, text on glass"
  },
  {
    id: "05D",
    name: "天台",
    duration: 5,
    clipDuration: 2.25,
    prompt: `Wide shot, 35mm lens, f/5.6, static camera. Strict center-symmetry. Person at exact vertical axis, standing at rooftop railing. Horizon at upper-third mark. Sky fills top two-thirds — massive negative space. Person is small, maybe 30% of frame height. Single person, back to camera, completely still at rooftop railing. Feet shoulder-width apart, hands on rail. They are the only static element — everything around them moves. Wind lifts jacket hem and hair. Weathered concrete with small puddles reflecting sky. Industrial metal railing, slightly rusted. Distant skyline with lit windows, construction crane, red aircraft warning blink. Two birds cross upper-left sky. Twilight — sky gradients from warm peach at horizon through lavender to deep blue-gray. Person backlit by residual horizon glow. ${STYLE_BLOCK}`,
    videoPrompt: "Static camera. The person stands completely still while the environment moves around them: wind lifts their jacket and hair, clouds drift slowly, two birds cross the sky in the upper-left. The puddles on the rooftop surface shimmer with reflected sky colors. A distant aircraft warning light blinks red.",
    negativePrompt: "looking at camera, sitting, phone in hand, crowded rooftop, bright city lights, night, dramatic clouds, unsafe railing position"
  },
  {
    id: "06",
    name: "花开",
    duration: 5,
    clipDuration: 2,
    prompt: `Macro timelapse, probe lens effect, f/4. Background: pure black void. Dead center composition. Flower occupies middle 40% of frame, surrounded by black. A single flower — species suggesting dahlia or ranunculus with layered complex petal structure. Color: amber-gold with slightly darker veining on inner petals. The bloom is mid-unfurl: outer petals partially open, revealing tighter inner spiral. Pollen dust visible as golden particles. Petal surfaces show cellular texture at macro scale: tiny ridges, translucent edges. One petal has a small natural blemish. Moisture beads on stem. Single hard side-light from camera-right, warm gold matching the flower's color. Black background absorbs everything. ${STYLE_BLOCK}`,
    videoPrompt: "Timelapse effect: the flower blooms in compressed time over 2 seconds. Outer petals unfurl first, revealing inner spiral that then unwinds. Brief pause mid-bloom before completing. Pollen dust releases as inner petals separate, catching the side light as golden particles. The single side light creates dramatic highlight-shadow split across petals.",
    negativePrompt: "vase, table, garden background, multiple flowers, rose, bright colorful background, slow motion water, romantic mood"
  },
  {
    id: "07A",
    name: "钢琴",
    duration: 5,
    clipDuration: 2,
    prompt: `Overhead bird's-eye, 50mm, f/2.8, static. Geometric: black and white keys form strong horizontal stripe pattern. Hands hovering 2-3cm above keys at center frame. A single beam of light crosses diagonally from upper-right to lower-left. A pair of hands — relaxed, slightly curved fingers, as if just played something casual and personal. Hands frozen in mid-state of lifting away: fingers still shaped around ghost of a chord, wrists beginning to rise. Two or three keys in micro-state of returning to rest position. Piano is old: ivory keys show hairline yellowing, one black key has small chip, wood grain visible. Skin on hands shows knuckle creases, small scar on one index finger. Dust particles mid-float in diagonal light beam. Warm afternoon light beam, everything outside falls into soft shadow. ${STYLE_BLOCK}`,
    videoPrompt: "Static overhead camera. Hands slowly lift away from the piano keys in ultra-slow motion — fingers still shaped around the ghost of a chord. Two keys slowly return to their rest position. Dust particles drift in the diagonal light beam. The movement is barely perceptible, suspended between playing and silence.",
    negativePrompt: "sheet music, modern digital piano, bright room, playing in progress, concert setting"
  },
  {
    id: "07B",
    name: "地铁",
    duration: 5,
    clipDuration: 2,
    prompt: `Wide shot, 24mm, f/4, static camera centered on vanishing point axis. Single-point perspective. ALL lines in subway car — ceiling rails, seat edges, floor grooves, handrail poles — converge to single vanishing point at dead center. Kubrick's geometric sovereignty. Empty subway car. Seats, standing poles, overhead advertisements create repeating modular pattern. Far end has window showing black tunnel. Fluorescent tubes flicker with barely perceptible rhythm. Seat fabric shows wear: center more faded than edges. Single forgotten newspaper on one seat. Floor has shoe scuff marks, dried water spots. Overhead fluorescent: cool white, slightly green-cast. Through far window: pure black tunnel. ${STYLE_BLOCK}`,
    videoPrompt: "Static camera locked on vanishing point. The fluorescent tubes flicker with a barely perceptible rhythm — not malfunction, just electrical pulse. The subway car sways very slightly from track movement. The newspaper pages shift microscopically from air circulation. Through the far window, darkness occasionally punctuated by a passing tunnel light.",
    negativePrompt: "passengers, bright modern subway, daylight through windows, digital screens, clean new interior"
  },
  {
    id: "07C",
    name: "布料的波",
    duration: 5,
    clipDuration: 2,
    prompt: `Extreme macro, 100mm, f/2.8, static camera. Abstract — no identifiable garment or space. Frame filled entirely with undulating fabric, creating terrain-like composition with ridges and valleys. Linen or raw silk fabric — the weave structure visible at this magnification: individual threads, crosshatch pattern, tiny imperfections. Afternoon sunlight passing THROUGH the fabric where it thins at wave crests — backlighting reveals internal fiber structure, making fabric glow translucent amber at peaks while remaining opaque warm gray in valleys. A single thread slightly loose along edge of frame. Strong backlight from window behind fabric. Warm amber at translucent peaks, warm gray in opaque valleys. ${STYLE_BLOCK}`,
    videoPrompt: "Static camera. A slow, continuous wave passes through the fabric from left to right, like a sound wave made visible — one long, slow undulation. The backlight reveals translucent amber at the wave crests. Individual threads are visible in the weave. The fabric breathes with the rhythm of wind.",
    negativePrompt: "identifiable clothing, person, hanger, room, pattern print, colorful fabric, synthetic material"
  },
  {
    id: "07D",
    name: "桌面物语",
    duration: 5,
    clipDuration: 2,
    prompt: `Overhead bird's-eye, 50mm, f/4, static. Flat-lay geometric. Five objects on warm-toned wooden desk with Kinfolk editorial precision but traces of actual use: (1) Glass of amber tea, two-thirds full (2) Pair of white earbuds coiled loosely (3) Small postcard showing Whistler's "Nocturne in Black and Gold" (4) Mechanical pencil with worn grip (5) Single amber-gold dried flower petal. Desk wood has natural grain and small ring stain. Postcard edges slightly soft from handling. Earbuds cable has natural twist. Graphite smudges on desk beside pencil. Flower petal curled at one edge, drying. Warm afternoon side light from upper-right. Long shadows extend to lower-left. Tea catches light and glows amber. ${STYLE_BLOCK}`,
    videoPrompt: "Static overhead camera. Extremely minimal movement: the tea surface catches a subtle shift in light, creating a brief shimmer. The dried flower petal curls almost imperceptibly. A shadow from an unseen curtain passes very slowly across the desk surface. Everything else is still — a tableau.",
    negativePrompt: "phone, laptop, modern devices, cluttered desk, bright white surface, overhead lighting, perfectly new objects"
  },
  {
    id: "08",
    name: "听到了",
    duration: 5,
    clipDuration: 4,
    prompt: `Close-up portrait, 85mm, f/1.8. Face fills 55% of frame, positioned on left-third line. Right side is soft warm shadow — negative space. Rembrandt lighting: triangle of light on shadow-side cheek. A young person, eyes closed, wearing minimal white earbuds. Expression of quiet recognition — micro-smile: corners of mouth lifted 2mm, no teeth. Eyebrows relaxed, slightly raised. Head tilted 5 degrees toward light source. Visible pores on nose and cheeks, small beauty mark below left eye, peach fuzz on jawline catching golden light. Hair natural, slightly tousled. Earbuds' white cable traces line down neck into collar of washed-out sage-green crewneck sweater. Eyelashes cast tiny shadows on upper cheeks. Golden hour light through sheer curtain at camera-right. Warmest frame in the entire film. Highlights: liquid honey gold. Shadows: warm sienna-umber. ${STYLE_BLOCK}`,
    videoPrompt: "Extremely slow dolly-in over 4 seconds — camera drawn toward the face like a whisper. The person's eyes remain closed. The micro-smile deepens almost imperceptibly over the duration. A breath lifts their chest slightly. Hair moves in a barely perceptible draft. Golden light plays across their skin with subtle intensity shifts.",
    negativePrompt: "open eyes, big smile, surprise expression, laughing, headphones, bright room, flat lighting, looking at phone, looking at camera"
  },
  {
    id: "10",
    name: "递出去",
    duration: 5,
    clipDuration: 4,
    prompt: `Medium two-shot, 50mm, f/2. Two people face to face — one in left third, one in right third. Phone being passed between them creates bridge at center. Background fully defocused. Two people, late 20s. Person A extends phone toward Person B — back of phone visible, screen facing away. Person B receives with both hands. Both wear lived-in casual clothing: slightly wrinkled, soft fabrics, no logos. Between them: two cups, one empty, one half-full amber tea. Window behind shows blue-hour sky. Late afternoon golden light from window at camera-right, matching Scene 08 but softer. Both faces receive warm side light. Table lamp adds secondary warm pool between them. Still warm but cooling at edges. ${STYLE_BLOCK}`,
    videoPrompt: "Slow track-in over 4 seconds. Person A extends phone toward Person B. Person B receives it with both hands, brings it slightly closer to their ear. Person B's expression shifts subtly over 4 seconds: neutral curiosity → head tilts 5 degrees → eyes soften → small genuine smile. Person A's hand lingers on the phone before releasing.",
    negativePrompt: "looking at camera, visible screen content, bright room, overhead lighting, multiple people beyond the two, hugging, exaggerated reaction"
  },
  {
    id: "11A",
    name: "最后的静物",
    duration: 5,
    clipDuration: 2,
    prompt: `Overhead bird's-eye, 85mm, f/2.8, static. Centered flat-lay. White earbuds resting on warm-toned wood, loosely coiled — placed down casually by someone who just finished listening. Beside them: clear glass tea cup, empty except for thin amber ring of dried tea at bottom and single tea leaf. No person in frame — but every element says "someone was just here." Wood surface: natural grain, faint circular water mark under cup. Earbud cable traces lazy S-curve resembling musical staff line. One earbud faces up, other faces down. Warm but diffused light — golden hour has passed. Neutral warm palette: amber tea stain, white earbuds, honey wood. Everything settling into quiet Murmur-brand warmth approaching #F5F1EB. ${STYLE_BLOCK}`,
    videoPrompt: "Static overhead camera. Almost imperceptible movement: the earbud cable slowly settles into its final resting position with a micro-shift. The tea residue in the cup catches a subtle light change. Everything is stillness — the afterimage of music.",
    negativePrompt: "phone, laptop, person, hand, multiple objects, cluttered, cold light, modern furniture, tea still full"
  },
];

// Scenes that are code-animated (skip AI generation)
const CODE_ANIM_SCENES = ["09", "09A", "09B", "09C", "11B"];

// ─── API Functions ───────────────────────────────────────────────────────────

async function generateSeedFrame(scene: SceneConfig): Promise<string> {
  console.log(`\n🖼️  Generating seed frame for Scene ${scene.id}: ${scene.name}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const response = await fetch(`${API_BASE}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: scene.prompt,
      size: "1536x864",  // 16:9 landscape
      quality: "high",
      n: 1,
      output_format: "png",
      background: "opaque",
      moderation: "low",
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`GPT-Image-2 API error ${response.status}: ${errText}`);
  }

  const data: Record<string, unknown> = await response.json();
  const resultUrl = (data.data as Record<string, unknown>[] | undefined)?.[0]?.url as string | undefined;

  if (!resultUrl) {
    throw new Error(`No image URL in response: ${JSON.stringify(data)}`);
  }

  // Download and save
  const dlController = new AbortController();
  const dlTimeout = setTimeout(() => dlController.abort(), 120_000);
  const imgResponse = await fetch(resultUrl, { signal: dlController.signal });
  clearTimeout(dlTimeout);
  if (!imgResponse.ok) throw new Error(`Seed download failed: ${imgResponse.status}`);
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
  const filename = `scene-${scene.id}_seed_v${getNextVersion(SEEDS_DIR, scene.id)}.png`;
  const filepath = join(SEEDS_DIR, filename);
  writeFileSync(filepath, imgBuffer);

  const usage = data.usage as Record<string, unknown> | undefined;
  console.log(`   ✅ Saved: ${filename}`);
  console.log(`   💰 Tokens: input=${usage?.input_tokens}, output=${usage?.output_tokens}, total=${usage?.total_tokens}`);

  return resultUrl;
}

async function generateVideoKlingO3(
  scene: SceneConfig,
  seedImageUrl: string,
  mode: "pro" | "std" = "std"
): Promise<string> {
  console.log(`\n🎬  Generating video (Kling O3 ${mode}) for Scene ${scene.id}: ${scene.name}`);

  const fullPrompt = `${scene.videoPrompt} ${resolveStyle(scene)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const response = await fetch(`${API_BASE}/klingai/m2v_omni_3_video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      images: [seedImageUrl],
      prompt: fullPrompt,
      duration: scene.duration,
      aspect_ratio: "16:9",
      mode: mode,
      o1_type: "referImage",
      enable_audio: false,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Kling O3 API error ${response.status}: ${errText}`);
  }

  const data: Record<string, unknown> = await response.json();
  const taskData = (data.data as Record<string, unknown> | undefined)?.task as Record<string, unknown> | undefined;
  const taskId = taskData?.id as string | undefined;
  const status = taskData?.status as string | undefined;

  if (!taskId) {
    throw new Error(`No task ID in response: ${JSON.stringify(data)}`);
  }

  // Save task metadata
  const taskMeta = {
    taskId,
    sceneId: scene.id,
    sceneName: scene.name,
    model: `kling-o3-${mode}`,
    status,
    createdAt: new Date().toISOString(),
    seedImageUrl,
  };
  writeFileSync(
    join(TASKS_DIR, `${taskId}.json`),
    JSON.stringify(taskMeta, null, 2)
  );

  console.log(`   📋 Task ID: ${taskId}`);
  console.log(`   ⏳ Status: ${status} (10=processing, 99=done, 50=failed)`);

  return taskId;
}

async function generateVideoDraft(
  scene: SceneConfig,
  seedImageUrl: string
): Promise<string> {
  console.log(`\n🎬  Generating DRAFT video (即梦 3.0) for Scene ${scene.id}: ${scene.name}`);

  const fullPrompt = `${scene.videoPrompt} ${resolveStyle(scene)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const response = await fetch(`${API_BASE}/doubao/drawing/jimengv30`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      prompt: fullPrompt,
      req_key: "jimeng_i2v_first_v30",  // 720p i2v, cheapest
      image_urls: [seedImageUrl],
      seed: -1,
      frames: scene.duration === 5 ? 121 : 241,  // 121=5s, 241=10s
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`即梦 3.0 API error ${response.status}: ${errText}`);
  }

  const data: Record<string, unknown> = await response.json();
  const taskId = ((data.data as Record<string, unknown> | undefined)?.task_id) as string | undefined;

  if (!taskId) {
    throw new Error(`No task ID in response: ${JSON.stringify(data)}`);
  }

  const taskMeta = {
    taskId,
    sceneId: scene.id,
    sceneName: scene.name,
    model: "jimeng-3.0-720p",
    status: "processing",
    createdAt: new Date().toISOString(),
    seedImageUrl,
  };
  writeFileSync(
    join(TASKS_DIR, `${taskId}.json`),
    JSON.stringify(taskMeta, null, 2)
  );

  console.log(`   📋 Task ID: ${taskId}`);

  return taskId;
}

// ─── Task Status & Download ──────────────────────────────────────────────────

async function checkKlingTaskStatus(taskId: string): Promise<Record<string, unknown>> {
  // Kling uses the same endpoint to check — re-fetch with task ID
  // Actually, 302.ai Kling uses a different query endpoint. Let me check...
  // The standard pattern is GET /klingai/task/{taskId} or similar.
  // Based on 302.ai patterns, try:
  const c1 = new AbortController();
  const t1 = setTimeout(() => c1.abort(), 30_000);
  const response = await fetch(`${API_BASE}/klingai/task/${taskId}/fetch`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${API_KEY}` },
    signal: c1.signal,
  });
  clearTimeout(t1);

  if (!response.ok) {
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), 30_000);
    const altResponse = await fetch(`${API_BASE}/klingai/m2v_omni_3_video/${taskId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${API_KEY}` },
      signal: c2.signal,
    });
    clearTimeout(t2);
    if (!altResponse.ok) {
      const errText = await altResponse.text();
      throw new Error(`Task status check failed ${altResponse.status}: ${errText}`);
    }
    return altResponse.json();
  }

  return response.json();
}

async function downloadVideo(url: string, sceneId: string, model: string): Promise<string> {
  const dir = model.includes("jimeng") ? DRAFTS_DIR : CLIPS_DIR;
  const version = getNextVersion(dir, sceneId);
  const filename = `scene-${sceneId}_${model}_v${version}.mp4`;
  const filepath = join(dir, filename);

  console.log(`\n📥 Downloading: ${filename}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(filepath, buffer);
  console.log(`   ✅ Saved: ${filepath}`);
  return filepath;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNextVersion(dir: string, sceneId: string): number {
  try {
    const files = readdirSync(dir).filter(f => f.startsWith(`scene-${sceneId}`));
    const versions = files.map(f => {
      const match = f.match(/_v(\d+)\./);
      return match ? parseInt(match[1]) : 0;
    });
    return Math.max(0, ...versions) + 1;
  } catch {
    return 1;
  }
}

function getScene(id: string): SceneConfig {
  const scene = SCENES.find(s => s.id === id);
  if (!scene) {
    console.error(`❌ Unknown scene: ${id}`);
    console.log(`Available scenes: ${SCENES.map(s => s.id).join(", ")}`);
    process.exit(1);
  }
  return scene;
}


// ─── CLI ─────────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case "seed": {
      const sceneId = args.includes("--all") ? "all" : args[args.indexOf("--scene") + 1];
      if (!sceneId) {
        console.error("Usage: bun run scripts/video-gen.ts seed --scene <id> | --all");
        process.exit(1);
      }

      if (sceneId === "all") {
        for (const scene of SCENES) {
          try {
            await generateSeedFrame(scene);
            // Rate limit: wait 2s between requests
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            console.error(`❌ Failed for Scene ${scene.id}:`, err);
          }
        }
      } else {
        const scene = getScene(sceneId);
        await generateSeedFrame(scene);
      }
      break;
    }

    case "video": {
      const sceneId = args[args.indexOf("--scene") + 1];
      const isDraft = args.includes("--draft");
      const seedUrl = args.includes("--seed-url") ? args[args.indexOf("--seed-url") + 1] : null;

      if (!sceneId) {
        console.error("Usage: bun run scripts/video-gen.ts video --scene <id> [--draft] [--seed-url <url>]");
        process.exit(1);
      }

      const scene = getScene(sceneId);

      const imageUrl = seedUrl;
      if (!imageUrl) {
        // Look for locally saved seed — but we need a URL for the API
        console.error("❌ Need --seed-url <url> (the URL returned from seed generation)");
        console.log("   Hint: Run 'seed --scene " + sceneId + "' first, then use the image URL from 302.ai");
        process.exit(1);
      }

      if (isDraft) {
        await generateVideoDraft(scene, imageUrl);
      } else {
        await generateVideoKlingO3(scene, imageUrl, "std");
      }
      break;
    }

    case "status": {
      const taskId = args[args.indexOf("--task") + 1];
      if (!taskId) {
        // List all tasks
        const taskFiles = readdirSync(TASKS_DIR).filter(f => f.endsWith(".json"));
        console.log("\n📋 All tasks:");
        for (const f of taskFiles) {
          const meta = JSON.parse(readFileSync(join(TASKS_DIR, f), "utf-8"));
          console.log(`   ${meta.taskId} | Scene ${meta.sceneId} (${meta.sceneName}) | ${meta.model} | ${meta.status} | ${meta.createdAt}`);
        }
        break;
      }

      console.log(`\n⏳ Checking task: ${taskId}`);
      try {
        const result = await checkKlingTaskStatus(taskId);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error("Failed:", err);
      }
      break;
    }

    case "download": {
      const url = args[args.indexOf("--url") + 1];
      const sceneId = args[args.indexOf("--scene") + 1];
      const model = args.includes("--draft") ? "jimeng-draft" : "kling-o3";

      if (!url || !sceneId) {
        console.error("Usage: bun run scripts/video-gen.ts download --url <video_url> --scene <id> [--draft]");
        process.exit(1);
      }

      await downloadVideo(url, sceneId, model);
      break;
    }

    case "test": {
      // End-to-end test: generate one seed frame for Scene 03
      console.log("🧪 Running end-to-end test with Scene 03...\n");
      const scene = getScene("03");

      console.log("Step 1: Generate seed frame...");
      const imageUrl = await generateSeedFrame(scene);

      console.log("\nStep 2: Generate video draft (即梦 3.0, cheaper)...");
      const taskId = await generateVideoDraft(scene, imageUrl);

      console.log("\n✅ Test initiated!");
      console.log(`   Seed frame saved to: ${SEEDS_DIR}`);
      console.log(`   Video task ID: ${taskId}`);
      console.log(`   Check status: bun run scripts/video-gen.ts status --task ${taskId}`);
      break;
    }

    case "list": {
      console.log("\n📋 Available scenes for AI generation:");
      console.log("─".repeat(60));
      for (const scene of SCENES) {
        const seedFiles = readdirSync(SEEDS_DIR).filter(f => f.startsWith(`scene-${scene.id}`));
        const clipFiles = readdirSync(CLIPS_DIR).filter(f => f.startsWith(`scene-${scene.id}`));
        const draftFiles = readdirSync(DRAFTS_DIR).filter(f => f.startsWith(`scene-${scene.id}`));
        console.log(`  ${scene.id} | ${scene.name.padEnd(12)} | ${scene.clipDuration}s | seeds:${seedFiles.length} clips:${clipFiles.length} drafts:${draftFiles.length}`);
      }
      console.log("─".repeat(60));
      console.log("\nCode-animated (skip): " + CODE_ANIM_SCENES.join(", "));
      break;
    }

    default:
      console.log(`
Murmur Video Generation Pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Commands:
  seed    --scene <id> | --all     Generate seed frame(s) via GPT-Image-2
  video   --scene <id> [--draft]   Generate video from seed (Kling O3 / 即梦 3.0)
  status  [--task <id>]            Check task status (or list all tasks)
  download --url <url> --scene <id> Download completed video
  test                             End-to-end test with Scene 03
  list                             List all scenes and their asset status

Examples:
  bun run scripts/video-gen.ts test
  bun run scripts/video-gen.ts seed --scene 03
  bun run scripts/video-gen.ts video --scene 03 --seed-url <url> --draft
  bun run scripts/video-gen.ts list
`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
