/**
 * render-share-html — produce a single self-contained .html the user can
 * download, AirDrop, attach to a message, or upload to any static host. It
 * embeds the audio as a data URL so the file plays offline; the visual is a
 * tiny inline canvas particle loop synced to <audio> playback.
 *
 * Output size is dominated by the MP3 data URL (~80–200KB for a 12s clip).
 */

type Vibe = "warm_particles" | "dust_room" | "end_credits" | "confetti_pulse" | "rain_glass" | "synth_glow" | string;

export interface ShareHtmlInput {
  title: string;
  vibe: string;
  bpm: number;
  keySig: string;
  duration: number;
  gradient: string;        // CSS gradient string
  preset: Vibe;            // visualConfig.preset
  audioDataUrl?: string;   // data:audio/mpeg;base64,... — optional
  tagline?: string;        // "from MURMUR"
}

export function buildShareHtml(input: ShareHtmlInput): string {
  const {
    title, vibe, bpm, keySig, duration, gradient, preset, audioDataUrl,
    tagline = "from MURMUR",
  } = input;

  // Extract two anchor colors from the CSS gradient for the canvas painter.
  const colorMatches = gradient.match(/#[0-9A-Fa-f]{6}/g) ?? ["#F4C87A", "#E9A06D"];
  const c1 = colorMatches[0] ?? "#F4C87A";
  const c2 = colorMatches[colorMatches.length - 1] ?? "#E9A06D";

  const safeTitle = escapeHtml(title);
  const safeVibe = escapeHtml(vibe);
  const safeTagline = escapeHtml(tagline);
  const safeKey = escapeHtml(keySig);
  const safePreset = escapeHtml(preset);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${safeTitle} · MURMUR</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #F7F3EA; font-family: -apple-system, "PingFang SC", "Helvetica Neue", system-ui, sans-serif; color: #22303A; -webkit-font-smoothing: antialiased; }
  body { display: flex; align-items: center; justify-content: center; padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom); }
  .card { width: min(420px, 100%); border-radius: 28px; overflow: hidden; box-shadow: 0 16px 48px rgba(34,48,58,0.18); background: #FFFDF8; }
  .visual { position: relative; aspect-ratio: 1 / 1; background: ${gradient}; overflow: hidden; }
  .visual canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .visual .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.45), transparent 60%); pointer-events: none; }
  .visual .meta { position: absolute; left: 22px; bottom: 22px; right: 22px; color: white; pointer-events: none; }
  .visual .vibe { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.7; }
  .visual h1 { font-family: "Lora", Georgia, serif; font-size: 28px; line-height: 1.1; margin-top: 6px; font-weight: 600; }
  .play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; border-radius: 50%; background: rgba(255,255,255,0.22); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.4); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.18s; }
  .play:hover { transform: translate(-50%, -50%) scale(1.06); }
  .play svg { width: 26px; height: 26px; fill: white; margin-left: 3px; }
  .play.playing svg { margin-left: 0; }
  .info { padding: 22px; display: flex; flex-direction: column; gap: 14px; }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge { padding: 4px 11px; border-radius: 999px; background: #F0EAE0; color: #22303A; font-size: 12px; font-weight: 500; }
  .footer { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid #F0EAE0; }
  .brand { font-family: "Lora", Georgia, serif; font-weight: 600; letter-spacing: 0.16em; font-size: 13px; color: #22303A; }
  .tag { font-size: 11px; color: #8B8680; }
  audio { display: none; }
</style>
</head>
<body>
<div class="card">
  <div class="visual" id="v">
    <canvas id="c"></canvas>
    <div class="overlay"></div>
    <div class="meta">
      <div class="vibe">${safeVibe}</div>
      <h1>${safeTitle}</h1>
    </div>
    ${audioDataUrl ? '<div class="play" id="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>' : ""}
  </div>
  <div class="info">
    <div class="badges">
      <span class="badge">${bpm} BPM</span>
      <span class="badge">${safeKey}</span>
      <span class="badge">${Math.round(duration)}s</span>
      <span class="badge">${safePreset}</span>
    </div>
    <div class="footer">
      <span class="brand">MURMUR</span>
      <span class="tag">${safeTagline}</span>
    </div>
  </div>
  ${audioDataUrl ? `<audio id="a" preload="auto" src="${audioDataUrl}"></audio>` : ""}
</div>
<script>
(function(){
  var canvas=document.getElementById('c'); if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var DPR=window.devicePixelRatio||1;
  function fit(){
    var rect=canvas.getBoundingClientRect();
    canvas.width=rect.width*DPR; canvas.height=rect.height*DPR; ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  fit(); window.addEventListener('resize',fit);
  var c1=hex2rgb('${c1}'), c2=hex2rgb('${c2}');
  function hex2rgb(h){return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}}
  var particles=[], frame=0, playing=false;
  function spawn(){
    var w=canvas.width/DPR, h=canvas.height/DPR;
    return {x:Math.random()*w,y:h+10,vx:(Math.random()-0.5)*1.2,vy:-(Math.random()*1.4+0.4),r:Math.random()*4+1.6,life:0,max:Math.random()*120+80};
  }
  function draw(){
    var w=canvas.width/DPR, h=canvas.height/DPR;
    var t=(frame%240)/240;
    var lerp=function(a,b){return Math.round(a+(b-a)*Math.sin(t*Math.PI))};
    var g=ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0,'rgb('+lerp(c1.r,c2.r)+','+lerp(c1.g,c2.g)+','+lerp(c1.b,c2.b)+')');
    g.addColorStop(1,'rgb('+c2.r+','+c2.g+','+c2.b+')');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
    var cap=playing?60:18, every=playing?3:14;
    if(particles.length<cap && frame%every===0) particles.push(spawn());
    particles=particles.filter(function(p){return p.life<p.max});
    for(var i=0;i<particles.length;i++){
      var p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.vy-=0.012; p.life++;
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r*(1-p.life/p.max*0.4),0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,'+((1-p.life/p.max)*0.55)+')';
      ctx.fill();
    }
    if(playing){
      var cx=w/2,cy=h/2,pulse=Math.sin(frame*0.1)*0.35+0.65;
      ctx.beginPath(); ctx.arc(cx,cy,46*pulse,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=2; ctx.stroke();
    }
    frame++; requestAnimationFrame(draw);
  }
  draw();
  var audio=document.getElementById('a'), btn=document.getElementById('play');
  if(audio && btn){
    btn.addEventListener('click',function(){
      if(audio.paused){ audio.play().catch(function(){}); }
      else audio.pause();
    });
    audio.addEventListener('play',function(){ playing=true; btn.classList.add('playing'); btn.innerHTML='<svg viewBox="0 0 24 24"><rect x="7" y="6" width="3.6" height="12" rx="1.4"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.4"/></svg>'; });
    audio.addEventListener('pause',function(){ playing=false; btn.classList.remove('playing'); btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; });
    audio.addEventListener('ended',function(){ playing=false; btn.classList.remove('playing'); btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; });
  }
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

export function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
