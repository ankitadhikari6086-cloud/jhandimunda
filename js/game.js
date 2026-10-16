// Free play only: no stakes, no payouts.
export const SYMBOLS = { flag: "🚩", crown: "👑", heart: "♥️", spade: "♠️", diamond: "♦️", club: "♣️" };
const NAMES = { flag: "Flag", crown: "Crown", heart: "Heart", spade: "Spade", diamond: "Diamond", club: "Club" };
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const seen = new Set(); // rounds whose dice-roll animation already played
const trays = new Map(); // round id -> dice DOM, kept so a re-render never interrupts a roll

// ---- 3D dice: real cubes (CSS 3D), thrown, bounced and tumbled onto the table ----
const FACES = { front: "", back: "rotateY(180deg)", right: "rotateY(90deg)", left: "rotateY(-90deg)", top: "rotateX(90deg)", bottom: "rotateX(-90deg)" };
const SHOW = { front: "rotateX(0) rotateY(0)", back: "rotateY(180deg)", right: "rotateY(-90deg)", left: "rotateY(90deg)", top: "rotateX(-90deg)", bottom: "rotateX(90deg)" };
const SYM_KEYS = Object.keys(SYMBOLS);
// Which symbol sits on which side of every die (opposite sides: flag/club, crown/diamond, heart/spade)
const SIDE_OF = { flag: "front", club: "back", crown: "right", diamond: "left", heart: "top", spade: "bottom" };
const SIDES = Object.keys(FACES);
const rnd = (a, b) => a + Math.random() * (b - a);

function makeDie(sym, i, mine, animate) {
  const die = el("div", { className: "die" + (mine ? " mine" : ""), title: NAMES[sym], role: "img", ariaLabel: NAMES[sym] });
  const shadow = el("div", { className: "shadow" }), cube = el("div", { className: "cube" });
  for (const side of SIDES) {
    const k = SYM_KEYS.find((x) => SIDE_OF[x] === side);
    const f = el("div", { className: "face f-" + side + (k === "heart" || k === "diamond" ? " red" : "") , textContent: SYMBOLS[k] });
    f.style.transform = `${FACES[side]} translateZ(calc(var(--s) / 2))`; cube.append(f);
  }
  // resting pose: every die lands the same way, rolled symbol facing you, so the result is easy to read
  const rest = `rotateX(-14deg) rotateY(-16deg) ${SHOW[SIDE_OF[sym]]}`;
  cube.style.transform = rest; die.append(shadow, cube);
  if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const T = 1500 + i * 120, delay = i * 90, ease = "cubic-bezier(.3,.5,.4,1)";
    const spin = () => `rotateX(${rnd(2, 4) * 360 * (Math.random() < .5 ? -1 : 1)}deg) rotateY(${rnd(2, 4) * 360 * (Math.random() < .5 ? -1 : 1)}deg) rotateZ(${rnd(1, 2) * 360}deg)`;
    cube.animate([{ transform: `${spin()} ${rest}` }, { transform: rest }], { duration: T, delay, easing: "cubic-bezier(.15,.6,.25,1)", fill: "backwards" });
    const x0 = rnd(-90, 90);
    die.animate([ // thrown from above, hits the table, bounces twice
      { transform: `translate(${x0}px,-300px) scale(.7)`, offset: 0, easing: "cubic-bezier(.5,0,1,.6)" },
      { transform: `translate(${x0 * .25}px,0) scale(1.05)`, offset: .42, easing: ease },
      { transform: `translate(${x0 * .1}px,-60px) scale(1)`, offset: .6, easing: "cubic-bezier(.5,0,1,.6)" },
      { transform: "translate(0,0)", offset: .78, easing: ease },
      { transform: "translate(0,-14px)", offset: .9, easing: "cubic-bezier(.5,0,1,.6)" },
      { transform: "translate(0,0)", offset: 1 }], { duration: T, delay, fill: "backwards" });
    shadow.animate([{ opacity: .1, transform: "scale(.4)" }, { opacity: .5, transform: "scale(1)", offset: .42 }, { opacity: .25, transform: "scale(.7)", offset: .6 }, { opacity: .5, transform: "scale(1)", offset: .78 }, { opacity: .5, transform: "scale(1)" }], { duration: T, delay, fill: "backwards" });
  }
  return die;
}
function diceTray(r, myPick, first) {
  const key = r.id;
  if (trays.has(key) && !first) return trays.get(key); // reuse (keeps any running animation alive)
  const d = el("div", { className: "dice", ariaLabel: "Dice results" });
  r.dice.forEach((x, i) => d.append(makeDie(x, i, x === myPick, first)));
  trays.set(key, d); if (trays.size > 3) trays.delete(trays.keys().next().value);
  return d;
}

// Marigold / festive petals burst, used when a round is rolled
export function petals(n = 36) {
  const box = document.getElementById("petals"); if (!box) return;
  const bits = ["🌼", "🏵️", "🪁", "✨", "🌺"];
  for (let i = 0; i < n; i++) {
    const p = el("span", { className: "petal", textContent: bits[i % bits.length] });
    p.style.left = Math.random() * 100 + "vw"; p.style.setProperty("--dx", (Math.random() * 200 - 100) + "px");
    p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg"); p.style.animationDuration = 2.5 + Math.random() * 2.5 + "s";
    p.style.animationDelay = Math.random() * 0.8 + "s"; box.append(p); setTimeout(() => p.remove(), 6500);
  }
}

export function renderGame(box, s, act) {
  box.replaceChildren();
  const host = s.room?.host_user_id === s.user.id, r = s.round;
  if (!r) {
    box.append(el("p", { className: "np", textContent: "🪔 Ready for the first throw? 🪔", style: "font-size:1.4rem;color:var(--red)" }));
    box.append(el("p", { textContent: "Everyone picks a symbol, then the host rolls six big dice." }));
    box.append(host ? el("button", { textContent: "🎲 Start round", onclick: act.start }) : el("p", { textContent: "Waiting for the host to start a round…" }));
    return;
  }
  if (r.status === "picking") {
    const mine = s.picks.find((p) => p.user_id === s.user.id)?.symbol;
    const row = el("div", { className: "symbols", role: "group", ariaLabel: "Choose your symbol" });
    for (const [k, v] of Object.entries(SYMBOLS)) {
      const b = el("button", { title: k, ariaLabel: k, ariaPressed: String(mine === k), onclick: () => act.pick(r.id, k) });
      b.append(v, el("small", { textContent: NAMES[k] })); row.append(b);
    }
    box.append(el("p", { textContent: `${s.picks.length}/${s.members.length} picked. ${mine ? "You can still change your pick." : "Choose your lucky symbol! 🍀"}` }), row);
    if (host) box.append(el("button", { textContent: "🎲 Roll the dice!", onclick: () => act.roll(r.id) })); // host only
    else box.append(el("p", { textContent: "The host rolls when everyone is ready." }));
  } else {
    const myPick = s.picks.find((q) => q.user_id === s.user.id)?.symbol;
    const first = !seen.has(r.id); seen.add(r.id);
    const d = diceTray(r, myPick, first);
    const list = el("div", { className: "results" });
    s.members.forEach((m) => {
      const p = s.picks.find((q) => q.user_id === m.user_id);
      const row = el("div", { className: "res" + (m.user_id === s.user.id ? " me" : "") });
      row.append(el("span", { className: "who", textContent: m.display_name }), el("span", { className: "sym", textContent: p?.symbol ? SYMBOLS[p.symbol] : "–" }));
      list.append(row);
    });
    const tally = el("p", { className: "tally" });
    for (const [k, v] of Object.entries(SYMBOLS)) { const n = r.dice.filter((x) => x === k).length; if (n) tally.append(el("span", { textContent: `${v} ×${n}` })); }
    box.append(d, tally, list);
    if (first) setTimeout(() => petals(24), 900);
    if (host) box.append(el("button", { textContent: "➡️ Next round", onclick: act.start, style: "margin-top:1rem" }));
  }
  box.append(el("p", { className: "cloth-note", textContent: "Free play only: no cash value." }));
}
