import { world, system, ItemStack, GameMode, EnchantmentTypes, EquipmentSlot } from "@minecraft/server";
import * as MC from "@minecraft/server"; // used for InputPermissionCategory (safe if missing)

const DIMENSION = "overworld";
const EQUIPPED_TAG = "slayer_equipped";
const LABEL_TAG = "slayer_label";
const LABEL_HEIGHT = 0.6; // height of the floating text above the stand

// Floating text (needs the jester:label entity + resource pack).
// Set to false if you don't use the resource pack.
const USE_LABEL_ENTITY = true;

// ---------- Players ----------
// Everyone who joins is put in survival mode. Give someone the tag "creative_ok"
// (/tag NAME add creative_ok) and they are left alone (use it for admins/builders).
const FORCE_SURVIVAL_ON_JOIN = true;
const KEEP_GAMEMODE_TAG = "creative_ok";

// ---------- Roles ----------
// Clicking a role stand gives the full armor set (worn automatically), the weapon and the role boost.
// The chosen role is remembered with a tag, so the boost comes back after dying or rejoining.
const ROLE_TAG_PREFIX = "role_";
const WIPE_TAG = "wipe_pending";
// (RESPAWN_WITH_KIT is no longer used: after dying the role is removed and they pick a new one)
const RESPAWN_WITH_KIT = true;
const ROLE_EFFECT_IDS = ["speed", "resistance", "health_boost", "jump_boost"];

// Arena commands for EVERYONE. Normal players cannot use /scriptevent (Minecraft only lets
// operators run slash commands), so the same commands also work as chat messages:
//   !arena   !arena here   !arena seed 42   !arena only 2 4 6 8   !title   !title here   !mountain   !ping
// Set to false to limit building to players with the tag "arena_admin".
const ARENA_COMMANDS_FOR_EVERYONE = true;
const ARENA_ADMIN_TAG = "arena_admin";

// Spawn point (block coords for the spawn, centered coords for the teleport)
const SPAWN_BLOCK = { x: -3, y: -59, z: 8 };
const SPAWN_TELEPORT = { x: -2.5, y: -59, z: 8.5 };

// Each entry is one floating, rotating armor stand.
const STANDS = [
  {
    tag: "slayer_sword",
    location: { x: -10.5, y: -59, z: 8.5 },
    weapon: "diamond_sword",
    armor: {
      head: "diamond_helmet",
      chest: "diamond_chestplate",
      legs: "diamond_leggings",
      feet: "diamond_boots",
    },
    label: "§b§lSLAYER", // diamond = aqua
    title: "§cYou are a Slayer!",
    reward: "minecraft:diamond_sword",
    weaponEnchants: [{ id: "sharpness", level: 3 }], // permanent Sharpness III sword
    effects: [],
    statsText: "§bSharpness III on your diamond sword",
  },
  {
    tag: "slayer_spear",
    location: { x: -2.5, y: -59, z: 0.5 },
    weapon: "netherite_spear",
    armor: {
      head: "netherite_helmet",
      chest: "netherite_chestplate",
      legs: "netherite_leggings",
      feet: "netherite_boots",
    },
    label: "§8§lHUNTER", // netherite = dark gray
    title: "§5You are a Hunter!",
    reward: "minecraft:netherite_spear",
    weaponEnchants: [],
    effects: [{ id: "speed", amplifier: 0 }], // Speed I, permanent (not too fast)
    statsText: "§8Permanent Speed I",
  },
  {
    tag: "slayer_mace",
    location: { x: -2.5, y: -59, z: 16.5 },
    weapon: "mace",
    armor: {
      head: "iron_helmet",
      chest: "iron_chestplate",
      legs: "iron_leggings",
      feet: "iron_boots",
    },
    label: "§f§lTANKER", // iron = white
    title: "§fYou are a Tanker!",
    reward: "minecraft:mace",
    weaponEnchants: [],
    // Resistance I = permanent damage reduction. Health Boost level 2 = +4 hearts
    // (Minecraft gives hearts in steps of 2 per level, so exactly 3 is not possible).
    effects: [
      { id: "resistance", amplifier: 0 },
      { id: "health_boost", amplifier: 1 },
    ],
    statsText: "§fPermanent Defense (Resistance I) and +4 hearts",
  },
  {
    tag: "slayer_bow",
    location: { x: 5.5, y: -59, z: 8.5 },
    weapon: "bow",
    armor: {
      head: "golden_helmet",
      chest: "golden_chestplate",
      legs: "golden_leggings",
      feet: "golden_boots",
    },
    label: "§6§lMARKSMAN", // gold armor = gold text
    title: "§6You are a Marksman!",
    reward: "minecraft:bow",
    // Infinity bow with Power III, plus 1 arrow = unlimited arrows. Jump Boost I for high ground.
    weaponEnchants: [
      { id: "infinity", level: 1 },
      { id: "power", level: 3 },
    ],
    effects: [{ id: "jump_boost", amplifier: 0 }],
    extraItems: [{ id: "minecraft:arrow", count: 1 }],
    statsText: "§6Power III + Infinity bow, permanent Jump Boost I",
  },
];

function equipStand(stand, cfg) {
  stand.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${cfg.weapon}`);
  stand.runCommand(`replaceitem entity @s slot.armor.head 0 ${cfg.armor.head}`);
  stand.runCommand(`replaceitem entity @s slot.armor.chest 0 ${cfg.armor.chest}`);
  stand.runCommand(`replaceitem entity @s slot.armor.legs 0 ${cfg.armor.legs}`);
  stand.runCommand(`replaceitem entity @s slot.armor.feet 0 ${cfg.armor.feet}`);
  stand.addTag(EQUIPPED_TAG);
}

// Make the stand very hard to hurt (backup, the real protection is the guard entity)
function protectStand(stand) {
  try {
    if (!stand.getEffect("resistance")) {
      stand.addEffect("resistance", 20000000, { amplifier: 4, showParticles: false });
    }
  } catch (e) {
    console.warn("protectStand addEffect failed: " + e);
  }
  try {
    if (!stand.getEffect("resistance")) {
      stand.runCommand("effect @s resistance 1000000 4 true");
    }
  } catch (e) {
    console.warn("protectStand command failed: " + e);
  }
}

// ---------- NO DROPS: turn off entity drops so broken stands drop nothing ----------

function disableEntityDrops() {
  try {
    world.gameRules.doEntityDrops = false;
  } catch (e) {}
  try {
    world.getDimension(DIMENSION).runCommand("gamerule doentitydrops false");
  } catch (e) {}
}
system.runTimeout(disableEntityDrops, 20);
system.runInterval(disableEntityDrops, 200); // re-apply every 10 seconds

// ---------- Floating label entity ----------

function labelSpotsFor(cfg) {
  return cfg.labelSpots ?? [{ x: 0, y: 0, z: 0 }];
}

function labelPosFor(cfg, spot) {
  return {
    x: cfg.location.x + spot.x,
    y: cfg.location.y + LABEL_HEIGHT + spot.y,
    z: cfg.location.z + spot.z,
  };
}

function ensureLabel(dim, cfg) {
  const spots = labelSpotsFor(cfg);

  // Remove leftover labels from spots that no longer exist
  for (let s = spots.length; s < spots.length + 4; s++) {
    for (const old of dim.getEntities({ tags: [`${LABEL_TAG}_${cfg.tag}_${s}`] })) old.remove();
  }

  for (let s = 0; s < spots.length; s++) {
    const labelTag = s === 0 ? `${LABEL_TAG}_${cfg.tag}` : `${LABEL_TAG}_${cfg.tag}_${s}`;
    const pos = labelPosFor(cfg, spots[s]);

    const labels = dim.getEntities({ tags: [labelTag] });

    let label;
    if (labels.length === 0) {
      label = dim.spawnEntity("jester:label", pos);
      label.addTag(LABEL_TAG);
      label.addTag(labelTag);
    } else {
      label = labels[0];
      for (let i = 1; i < labels.length; i++) labels[i].remove();
    }

    if (label.nameTag !== cfg.label) label.nameTag = cfg.label;

    const dx = label.location.x - pos.x;
    const dy = label.location.y - pos.y;
    const dz = label.location.z - pos.z;
    if (dx * dx + dy * dy + dz * dz > 0.01) label.teleport(pos);
  }
}

// Debug helper: logs where every label is (see the content log)
function debugLabels() {
  const dim = world.getDimension(DIMENSION);
  for (const cfg of STANDS) {
    const spots = labelSpotsFor(cfg);
    for (let s = 0; s < spots.length; s++) {
      const labelTag = s === 0 ? `${LABEL_TAG}_${cfg.tag}` : `${LABEL_TAG}_${cfg.tag}_${s}`;
      const labels = dim.getEntities({ tags: [labelTag] });
      console.warn(
        `[label] ${cfg.tag} #${s}: ${labels.length} label(s)` +
          (labels[0]
            ? ` at ${labels[0].location.x.toFixed(1)}, ${labels[0].location.y.toFixed(1)}, ${labels[0].location.z.toFixed(1)}`
            : "")
      );
    }
  }
}
// Debug helper: logs how many guard hitboxes exist per stand (should be 1 each)
function debugGuards() {
  const dim = world.getDimension(DIMENSION);
  for (const cfg of STANDS) {
    const n = dim.getEntities({ tags: [`guard_${cfg.tag}`] }).length;
    console.warn(`[guard] ${cfg.tag}: ${n} guard(s)`);
  }
}
// Debug printing is OFF. To turn it back on, remove the // below:
// system.runTimeout(debugLabels, 200);
// system.runTimeout(debugGuards, 210);

// ---------- Guard: invisible invulnerable hitbox around each stand ----------

function guardTag(cfg) {
  return `guard_${cfg.tag}`;
}

function standCfgFor(entity) {
  return STANDS.find((s) => entity.hasTag(s.tag) || entity.hasTag(guardTag(s)));
}

const guardWarned = new Set(); // stands whose guard error was already logged

function ensureGuard(dim, cfg) {
  const guards = dim.getEntities({ tags: [guardTag(cfg)] });
  let guard;
  if (guards.length === 0) {
    guard = dim.spawnEntity("jester:guard", cfg.location);
    guard.addTag(guardTag(cfg));
  } else {
    guard = guards[0];
    for (let i = 1; i < guards.length; i++) guards[i].remove();
  }
  const dx = guard.location.x - cfg.location.x;
  const dy = guard.location.y - cfg.location.y;
  const dz = guard.location.z - cfg.location.z;
  if (dx * dx + dy * dy + dz * dz > 0.01) guard.teleport(cfg.location);
}

// ---------- Armor stands (anti-duplicate + auto-restore) ----------

const lastSpawnTick = new Map(); // stand tag -> tick it was last spawned
let ignoreRemoveUntil = 0; // ticks where our own cleanup shouldn't trigger a restore

function ensureDisplays() {
  const dim = world.getDimension(DIMENSION);

  // Wait a moment after the world loads so saved stands load first (prevents duplicates)
  if (system.currentTick < 60) return;

  for (const cfg of STANDS) {
    try {
      if (!dim.getBlock(cfg.location)) throw new Error("chunk not loaded");

      const found = new Map();
      for (const e of dim.getEntities({ tags: [cfg.tag] })) found.set(e.id, e);
      for (const e of dim.getEntities({
        type: "minecraft:armor_stand",
        location: cfg.location,
        maxDistance: 2,
      })) {
        if (e.hasTag(LABEL_TAG)) continue;
        found.set(e.id, e);
      }

      const stands = [...found.values()].sort(
        (a, b) => Number(b.hasTag(cfg.tag)) - Number(a.hasTag(cfg.tag))
      );
      let keep;

      if (stands.length === 0) {
        const last = lastSpawnTick.get(cfg.tag) ?? -100;
        if (system.currentTick - last < 10) throw new Error("just spawned");
        lastSpawnTick.set(cfg.tag, system.currentTick);

        keep = dim.spawnEntity("minecraft:armor_stand", cfg.location);
        keep.addTag(cfg.tag);
        equipStand(keep, cfg);
      } else {
        keep = stands[0];
        if (stands.length > 1) ignoreRemoveUntil = system.currentTick + 3;
        for (let i = 1; i < stands.length; i++) stands[i].remove();

        if (!keep.hasTag(cfg.tag)) keep.addTag(cfg.tag);
        if (!keep.hasTag(EQUIPPED_TAG)) equipStand(keep, cfg);
        // Re-equip every 5 seconds, so a missing piece (like the diamond helmet) always comes back
        else if (system.currentTick % 100 === 0) equipStand(keep, cfg);

        // Keep it in place and slowly spinning
        const rot = keep.getRotation();
        keep.teleport(cfg.location, { rotation: { x: 0, y: rot.y + 4 } });
      }

      protectStand(keep);

      const wantedName = USE_LABEL_ENTITY ? "" : cfg.label;
      if (keep.nameTag !== wantedName) keep.nameTag = wantedName;
    } catch (e) {
      // try again next tick
    }

    if (USE_LABEL_ENTITY) {
      try {
        ensureLabel(dim, cfg);
      } catch (e) {}
    }

    try {
      ensureGuard(dim, cfg);
    } catch (e) {
      if (!guardWarned.has(cfg.tag) && !String(e).includes("chunk")) {
        guardWarned.add(cfg.tag);
        console.warn(`[guard] ${cfg.tag} failed: ${e}`);
      }
    }
  }
}

system.runInterval(ensureDisplays, 1);

// Instantly restore a stand the moment it breaks (covers creative-mode punches)
let restoreQueued = false;
function restoreNow() {
  if (restoreQueued) return;
  restoreQueued = true;
  system.run(() => {
    restoreQueued = false;
    ensureDisplays();
  });
}

// Delete every item lying near any stand, using a command so it happens instantly
function wipeItemsNearStands() {
  const dim = world.getDimension(DIMENSION);
  for (const cfg of STANDS) {
    try {
      const { x, y, z } = cfg.location;
      dim.runCommand(`kill @e[type=item,x=${x},y=${y},z=${z},r=6]`);
    } catch (e) {}
  }
}

function onStandBroken() {
  wipeItemsNearStands(); // right now
  system.run(wipeItemsNearStands); // and again next tick, in case drops spawn late
  restoreNow();
}

world.afterEvents.entityDie.subscribe((event) => {
  if (event.deadEntity?.typeId === "minecraft:armor_stand") onStandBroken();
});

world.afterEvents.entityRemove.subscribe((event) => {
  if (system.currentTick < ignoreRemoveUntil) return; // we removed a duplicate ourselves
  if (event.typeId === "minecraft:armor_stand") onStandBroken();
});

// ---------- Stands can't be hurt or broken by hits ----------

function isProtected(e) {
  try {
    return e.hasTag(LABEL_TAG) || STANDS.some((s) => e.hasTag(s.tag));
  } catch (err) {
    return false;
  }
}

// If a hit still lands, refill health right away so repeated hits never add up
try {
  world.afterEvents.entityHurt.subscribe((event) => {
    const e = event.hurtEntity;
    if (!isProtected(e)) return;
    try {
      e.getComponent("minecraft:health")?.resetToMaxValue();
    } catch (err) {}
  });
} catch (e) {}

// Also refill health every tick (covers anything the events miss)
system.runInterval(() => {
  const dim = world.getDimension(DIMENSION);
  for (const cfg of STANDS) {
    try {
      for (const e of dim.getEntities({ tags: [cfg.tag] })) {
        e.getComponent("minecraft:health")?.resetToMaxValue();
      }
      for (const g of dim.getEntities({ tags: [guardTag(cfg)] })) {
        g.getComponent("minecraft:health")?.resetToMaxValue();
      }
    } catch (err) {}
  }
}, 1);

// ---------- Delete leftover drops (backup if anything still drops) ----------

function cleanDrops() {
  const dim = world.getDimension(DIMENSION);

  for (const cfg of STANDS) {
    try {
      for (const e of dim.getEntities({
        type: "minecraft:item",
        location: cfg.location,
        maxDistance: 5,
      })) {
        e.remove(); // delete every item near a stand, whatever it is
      }
    } catch (e) {}
  }
}

system.runInterval(cleanDrops, 1);

// Remove the drop the instant it spawns (so it never even flashes)
world.afterEvents.entitySpawn.subscribe((event) => {
  const e = event.entity;
  try {
    if (e.typeId !== "minecraft:item") return;

    for (const cfg of STANDS) {
      const dx = e.location.x - cfg.location.x;
      const dy = e.location.y - cfg.location.y;
      const dz = e.location.z - cfg.location.z;
      if (dx * dx + dy * dy + dz * dz > 25) continue; // within 5 blocks

      e.remove();
      return;
    }
  } catch (err) {}
});

// ---------- Accepting a role (right click AND left click) ----------

function hasItem(player, typeId) {
  const container = player.getComponent("inventory").container;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && item.typeId === typeId) return true;
  }
  return false;
}

// ---------- Role kit + permanent boosts ----------

function roleCfgOf(player) {
  return STANDS.find((s) => player.hasTag(ROLE_TAG_PREFIX + s.tag));
}

function makeWeapon(cfg) {
  const item = new ItemStack(cfg.reward, 1);
  const enc = item.getComponent("minecraft:enchantable");
  for (const e of cfg.weaponEnchants ?? []) {
    try {
      enc?.addEnchantment({ type: EnchantmentTypes.get(e.id), level: e.level });
    } catch (err) {
      console.warn("[role] enchant " + e.id + " failed: " + err);
    }
  }
  return item;
}

function weaponHasEnchants(item, cfg) {
  const enc = item.getComponent("minecraft:enchantable");
  return (cfg.weaponEnchants ?? []).every((e) => (enc?.getEnchantment(e.id)?.level ?? 0) >= e.level);
}

// Gives the weapon, or swaps a plain one for the enchanted one. Returns true if something changed.
function ensureWeapon(player, cfg) {
  const container = player.getComponent("inventory").container;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item && item.typeId === cfg.reward) {
      if (weaponHasEnchants(item, cfg)) return false;
      container.setItem(i, makeWeapon(cfg));
      return true;
    }
  }
  container.addItem(makeWeapon(cfg));
  return true;
}

// Puts the full armor set on the player (replaces whatever they wear). Returns true if changed.
function equipRoleArmor(player, cfg) {
  const eq = player.getComponent("minecraft:equippable");
  if (!eq) return false;
  const parts = [
    [EquipmentSlot.Head, cfg.armor.head],
    [EquipmentSlot.Chest, cfg.armor.chest],
    [EquipmentSlot.Legs, cfg.armor.legs],
    [EquipmentSlot.Feet, cfg.armor.feet],
  ];
  let changed = false;
  for (const [slot, name] of parts) {
    const id = "minecraft:" + name;
    if (eq.getEquipment(slot)?.typeId === id) continue;
    eq.setEquipment(slot, new ItemStack(id, 1));
    changed = true;
  }
  return changed;
}

function giveRoleKit(player, cfg) {
  let gave = false;
  try {
    if (equipRoleArmor(player, cfg)) gave = true;
  } catch (e) {
    console.warn("[role] armor failed: " + e);
  }
  try {
    if (ensureWeapon(player, cfg)) gave = true;
  } catch (e) {
    console.warn("[role] weapon failed: " + e);
  }
  try {
    for (const x of cfg.extraItems ?? []) {
      if (!hasItem(player, x.id)) {
        player.getComponent("inventory").container.addItem(new ItemStack(x.id, x.count));
        gave = true;
      }
    }
  } catch (e) {
    console.warn("[role] extra items failed: " + e);
  }
  return gave;
}

// Permanent boosts: long effects that are topped up again whenever they run low
function applyRoleEffects(player, force = false) {
  const cfg = roleCfgOf(player);
  if (!cfg) return;
  for (const ef of cfg.effects ?? []) {
    try {
      const cur = player.getEffect(ef.id);
      if (!force && cur && cur.amplifier === ef.amplifier && cur.duration > 2000) continue;
      player.addEffect(ef.id, 1000000, { amplifier: ef.amplifier, showParticles: false });
    } catch (e) {}
  }
}

function setRole(player, cfg) {
  for (const t of player.getTags()) {
    if (t.startsWith(ROLE_TAG_PREFIX)) player.removeTag(t);
  }
  player.addTag(ROLE_TAG_PREFIX + cfg.tag);
  for (const id of ROLE_EFFECT_IDS) {
    try {
      player.removeEffect(id); // clear the boosts of any previous role
    } catch (e) {}
  }
  applyRoleEffects(player, true);
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) applyRoleEffects(player);
}, 40);

function acceptRole(player, cfg) {
  player.onScreenDisplay.setTitle(cfg.title, {
    stayDuration: 60,
    fadeInDuration: 10,
    fadeOutDuration: 10,
  });
  player.setGameMode(GameMode.survival);

  setRole(player, cfg);
  const gave = giveRoleKit(player, cfg);

  player.sendMessage("§eRole boost: " + cfg.statsText);
  if (gave) player.playSound("random.levelup");
  else player.onScreenDisplay.setActionBar("§7You already have your full kit. " + cfg.statsText);
}

// Right click
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  if (event.target.hasTag(LABEL_TAG)) {
    event.cancel = true;
    return;
  }

  const cfg = standCfgFor(event.target);
  if (!cfg) return;

  event.cancel = true; // stops the player from taking or swapping items

  const player = event.player;
  system.run(() => {
    joinRole(player, cfg); // picks a free arena (max 10 per role), gives the kit, teleports to the camp
  });
});

// Left click (hit)
world.afterEvents.entityHitEntity.subscribe((event) => {
  const player = event.damagingEntity;
  const target = event.hitEntity;
  if (player?.typeId !== "minecraft:player") return;

  try {
    const cfg = standCfgFor(target);
    if (!cfg) return;
    joinRole(player, cfg);
    onStandBroken();
  } catch (e) {}
});

// ---------- Spawn point + welcome text + survival mode for joiners ----------

function showWelcome(player) {
  const lines = [
    { text: "§fWelcome to", delay: 0, stay: 27 },
    { text: "§fCNMB PROJECT", delay: 33, stay: 27 },
    { text: "§fmade by jhnslcc", delay: 66, stay: 28 },
  ];

  for (const line of lines) {
    system.runTimeout(() => {
      try {
        player.onScreenDisplay.setTitle(line.text, {
          fadeInDuration: 3,
          stayDuration: line.stay,
          fadeOutDuration: 3,
        });
      } catch (e) {}
    }, line.delay);
  }
}

function sendToSpawn(player) {
  try {
    player.teleport(SPAWN_TELEPORT, { dimension: world.getDimension(DIMENSION) });
  } catch (e) {}
}

function forceSurvival(player) {
  if (!FORCE_SURVIVAL_ON_JOIN) return;
  try {
    if (player.hasTag(KEEP_GAMEMODE_TAG)) return;
    player.setGameMode(GameMode.survival);
  } catch (e) {
    console.warn("[join] could not set survival: " + e);
  }
}

// ---------- Death: items and armor disappear (nobody can pick them up or duplicate them) ----------

// Removes everything the player carries and wears
function wipePlayerItems(player) {
  try {
    player.runCommand("clear @s");
  } catch (e) {}
  for (const slot of ["slot.armor.head", "slot.armor.chest", "slot.armor.legs", "slot.armor.feet", "slot.weapon.offhand"]) {
    try {
      player.runCommand(`replaceitem entity @s ${slot} 0 air`);
    } catch (e) {}
  }
}

const recentDeaths = []; // { x, y, z, dim, tick }

function killItemsAt(dim, loc) {
  try {
    dim.runCommand(`kill @e[type=item,x=${loc.x},y=${loc.y},z=${loc.z},r=8]`);
  } catch (e) {}
}

world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  if (dead?.typeId !== "minecraft:player") return;
  try {
    dead.addTag(WIPE_TAG); // wiped again when they respawn (covers keepInventory being on)
    const loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z };
    const dim = dead.dimension;
    recentDeaths.push({ ...loc, dim: dim.id, tick: system.currentTick });
    // the drops can appear a moment late, so delete them several times
    for (const t of [0, 1, 2, 4, 8, 15, 30, 60]) {
      system.runTimeout(() => killItemsAt(dim, loc), t);
    }
  } catch (e) {}
});

// Any item that spawns right where a player just died is deleted instantly
world.afterEvents.entitySpawn.subscribe((event) => {
  const e = event.entity;
  try {
    if (e.typeId !== "minecraft:item") return;
    const now = system.currentTick;
    while (recentDeaths.length && now - recentDeaths[0].tick > 100) recentDeaths.shift();
    for (const d of recentDeaths) {
      const dx = e.location.x - d.x;
      const dy = e.location.y - d.y;
      const dz = e.location.z - d.z;
      if (dx * dx + dy * dy + dz * dz <= 64) {
        e.remove();
        return;
      }
    }
  } catch (err) {}
});

function wipeIfPending(player) {
  try {
    if (!player.hasTag(WIPE_TAG)) return;
    wipePlayerItems(player);
    player.removeTag(WIPE_TAG);
  } catch (e) {}
}

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;

  disableEntityDrops();

  try {
    player.setSpawnPoint({ dimension: world.getDimension(DIMENSION), ...SPAWN_BLOCK });
    world.setDefaultSpawnLocation(SPAWN_BLOCK);
  } catch (e) {}

  if (event.initialSpawn) {
    unfreezeEffects(player); // never stay locked after rejoining
    if (arenaIndexOf(player) >= 0 || player.hasTag(SPEC_TAG)) {
      // left in the middle of a match: they are out of it now
      clearMatchTags(player);
      stopSpectating(player);
      resetPlayerForNewGame(player);
    }
    forceSurvival(player); // every joiner starts in survival
    if (player.hasTag(WIPE_TAG)) resetPlayerForNewGame(player); // died, then left before respawning
    wipeIfPending(player); // died, then left before respawning
    system.runTimeout(() => {
      forceSurvival(player); // again after the world has fully loaded them in
      sendToSpawn(player);
      showWelcome(player);
      applyRoleEffects(player, true); // role boost comes back after rejoining
    }, 10);
  } else {
    wipeIfPending(player); // died: everything they had is gone
    system.runTimeout(() => {
      // Eliminated during a running match: watch the others (1st / 3rd person) until it ends
      if (player.hasTag(SPEC_TAG) && beginSpectatingAfterDeath(player)) return;
      clearMatchTags(player);
      resetPlayerForNewGame(player); // no role, no effects, no items
      forceSurvival(player);
      sendToSpawn(player); // back at the spawn: click a role stand to join a new game
    }, 2);
  }
});

// ---------- CNMP header (bright white floating text) ----------

const HEADER_TAG = "cnmp_header";
const HEADER_TEXT = "§f§lCNMB"; // §f = bright white, §l = bold

// Middle of the gazebo, between the pillars and in front of the spawn.
const HEADER_POS = { x: -2.5, y: -59, z: 8.5 };

function ensureHeader() {
  try {
    const dim = world.getDimension(DIMENSION);
    if (!dim.getBlock(HEADER_POS)) return; // wait until the chunk is loaded

    const found = dim.getEntities({ tags: [HEADER_TAG] });
    const labels = found.filter((e) => e.typeId === "jester:label");

    for (const e of found) {
      if (e.typeId !== "jester:label") e.remove();
    }

    let header;
    if (labels.length === 0) {
      header = dim.spawnEntity("jester:label", HEADER_POS);
      header.addTag(HEADER_TAG);
      header.addTag(LABEL_TAG);
    } else {
      header = labels[0];
      for (let i = 1; i < labels.length; i++) labels[i].remove();
    }

    if (header.nameTag !== HEADER_TEXT) header.nameTag = HEADER_TEXT;
    header.teleport(HEADER_POS);
  } catch (e) {
    console.warn("CNMP header failed: " + e);
  }
}

system.runInterval(ensureHeader, 20);

// =====================================================================
// ARENA: 300 x 300 ruined-kingdom battle arena (built into main.js)
//
//   Anyone can use these (as chat messages) or as /scriptevent for operators:
//   !arena            /scriptevent jester:arena            build at ARENA_CENTER
//   !arena here       /scriptevent jester:arena here       build around the spot you stand on
//   !arena seed 42    same, with a different random layout
//   !arena only 2 4 6 8   build only those sections
//   !title            /scriptevent jester:title            rebuild ONLY the big sky title
//   !title here       centered on the spot you stand on
//   !mountain         /scriptevent jester:mountain         build the mountain ring around the arena
//   !mountain only 3 7    rebuild only those mountain sections (1-16)
//   !ping             check that the script is running
//
//   Sections (3 x 3 grid, numbered row by row):
//        1 NW   2 N   3 NE
//        4 W    5 C   6 E
//        7 SW   8 S   9 SE
//
// WARNING: everything inside the 300 x 300 area (30 blocks up from the floor) is
// erased first, and the ground is rebuilt. There is no undo, so back up the world.
// =====================================================================

const ARENA_SIZE = 300;
const ARENA_HALF = ARENA_SIZE / 2;
const ARENA_SECTION = 100; // built one 100 x 100 piece at a time (keeps chunks loaded)
const ARENA_CENTER = { x: -69, z: -222, floorY: -61 }; // floorY = the grass block layer
const ARENA_SEED = 1337;
const ARENA_BUDGET = 300; // work per tick; lower this if the game lags
const ARENA_AREA_NAME = "jester_arena";
const ARENA_LOAD_TIMEOUT = 1200; // ticks to wait for a section's chunks to load (1 minute)
const ARENA_STALL_TIMEOUT = 600; // ticks to wait on one stuck command before giving up on it

// Big title over the middle of the arena.
//   TITLE_MODE "blocks" = giant red block letters on two lines (letters C N M P A R E and space)
//   TITLE_MODE "text"   = small floating text (cannot be made bigger by the game)
const ARENA_TITLE = "CNMP ARENA"; // used by the floating-text mode and the messages
const TITLE_MODE = "blocks";
const TITLE_LINES = ["CNMP", "ARENA"]; // block mode: top line, bottom line
const TITLE_TEXT_COLOR = "§c§l";
const TITLE_TEXT_HEIGHT = 157; // text mode: height above the arena floor
const TITLE_SCALE = 9; // blocks per letter pixel (9 = biggest that fits the arena with 2 lines)
const TITLE_BASE = 140; // height of the bottom of the letters above the arena floor (dragon top is about 134)

let arenaBusy = false;

// ---------- Role stand -> arena camp teleport ----------
const STAND_CAMPS = {
  slayer_sword: { dx: 0, dz: -110, name: "§b§lSLAYER CAMP" }, // north, diamond
  slayer_spear: { dx: 110, dz: 0, name: "§8§lHUNTER CAMP" }, // east, netherite
  slayer_mace: { dx: 0, dz: 110, name: "§f§lTANKER CAMP" }, // south, iron
  slayer_bow: { dx: -110, dz: 0, name: "§6§lMARKSMAN CAMP" }, // west, gold
};

// Remembers where the arena was last built (also works with "here"), even after a restart
let activeArena = null;
function getActiveArena() {
  if (activeArena) return activeArena;
  try {
    const raw = world.getDynamicProperty("jester_arena_pos");
    if (typeof raw === "string") {
      const a = JSON.parse(raw);
      if ([a.cx, a.cz, a.fy].every(Number.isFinite)) {
        activeArena = a;
        return a;
      }
    }
  } catch (e) {}
  activeArena = { cx: ARENA_CENTER.x, cz: ARENA_CENTER.z, fy: ARENA_CENTER.floorY };
  return activeArena;
}
function setActiveArena(cx, cz, fy) {
  activeArena = { cx, cz, fy };
  try {
    world.setDynamicProperty("jester_arena_pos", JSON.stringify(activeArena));
  } catch (e) {}
}

const arenaTeleportTick = new Map(); // player id -> tick of the last teleport
function goToArena(player, cfg, arenaIndex = 0) {
  const camp = STAND_CAMPS[cfg.tag];
  if (!camp) return;
  const last = arenaTeleportTick.get(player.id) ?? -1000;
  if (system.currentTick - last < 60) return; // 3 second cooldown (a click can fire twice)
  arenaTeleportTick.set(player.id, system.currentTick);

  const a = getArenaByIndex(arenaIndex); // 0 = the first arena, 1+ = the copies
  const px = a.cx + camp.dx;
  const pz = a.cz + camp.dz;
  const dest = { x: px + Math.sign(-camp.dx) * 5 + 0.5, y: a.fy + 1, z: pz + Math.sign(-camp.dz) * 5 + 0.5 };
  try {
    player.teleport(dest, {
      dimension: world.getDimension(DIMENSION),
      facingLocation: { x: a.cx + 0.5, y: a.fy + 2, z: a.cz + 0.5 },
    });
    player.onScreenDisplay.setActionBar(camp.name + "§r §7- Arena " + (arenaIndex + 1));
    player.playSound("mob.endermen.portal");
    beginArenaCountdown(player, dest); // freeze + 10..1 timer + START!
  } catch (e) {
    console.warn("[arena] teleport failed: " + e);
  }
}

// =====================================================================
// ARENA COUNTDOWN: players are frozen at their camp (they can still look around),
// 10..1 timer, then START! Players who arrive while a countdown is running join it.
// =====================================================================
const COUNTDOWN_SECONDS = 10;
const NARRATOR_SOUND = "cnmb.narrator.start"; // sound id in RP/sounds/sound_definitions.json
let arenaCountdown = null; // { remaining, tick, frozen: Map(playerId -> position) }
let countdownRunId = null;

// Players with this tag can break/place blocks (nobody has it by default).
// Give it with: /tag YourName add can_build
const BREAK_EXEMPT_TAG = "can_build";

const hardFrozen = new Set(); // players locked with input permissions

function findPlayerById(id) {
  return world.getAllPlayers().find((p) => p.id === id);
}

// Locks/unlocks walking, jumping and sneaking. Camera (looking around) is NOT touched.
function setMovementLocked(player, locked) {
  const cat = MC.InputPermissionCategory;
  if (!cat || !player.inputPermissions) return false;
  try {
    player.inputPermissions.setPermissionCategory(cat.Movement, !locked);
    return true;
  } catch (e) {
    return false;
  }
}

function freezeEffects(player) {
  if (setMovementLocked(player, true)) {
    hardFrozen.add(player.id);
    try { player.clearVelocity(); } catch (e) {}
    return;
  }
  // Fallback for older API versions: slowness + snap-back (see tickCountdown)
  try { player.addEffect("slowness", 400, { amplifier: 255, showParticles: false }); } catch (e) {}
}

function unfreezeEffects(player) {
  hardFrozen.delete(player.id);
  setMovementLocked(player, false);
  try { player.removeEffect("slowness"); } catch (e) {}
}

function showCountdownNumber(player, n) {
  const color = n <= 3 ? "§c" : n <= 5 ? "§e" : "§a";
  try {
    player.onScreenDisplay.setTitle(`${color}§l${n}`, {
      subtitle: "§7Get ready...",
      fadeInDuration: 0,
      stayDuration: 18,
      fadeOutDuration: 2,
    });
    // tick sound, higher and sharper for the last 3 seconds
    if (n <= 3) player.playSound("note.pling", { pitch: 0.9 + (4 - n) * 0.3, volume: 1 });
    else player.playSound("note.hat", { pitch: 1, volume: 1 });
  } catch (e) {}
}

function showStartLogo(player) {
  try {
    player.onScreenDisplay.setTitle("§6§l» §c§lSTART! §6§l«", {
      subtitle: "§eFight to survive!",
      fadeInDuration: 0,
      stayDuration: 30,
      fadeOutDuration: 10,
    });
    // "dopamine" sound stack
    player.playSound("random.totem", { volume: 1, pitch: 1 });
    player.playSound("random.levelup", { volume: 1, pitch: 1.2 });
    player.playSound("firework.launch", { volume: 1, pitch: 1 });
    system.runTimeout(() => {
      try { player.playSound("firework.largeBlast", { volume: 1, pitch: 1 }); } catch (e) {}
    }, 6);
    system.runTimeout(() => {
      try { player.playSound(NARRATOR_SOUND, { volume: 1, pitch: 1 }); } catch (e) {} // needs the sound files in the resource pack
    }, 10);
  } catch (e) {}
}

function endCountdown() {
  if (countdownRunId !== null) {
    system.clearRun(countdownRunId);
    countdownRunId = null;
  }
  arenaCountdown = null;
}

function dropFromCountdown(playerId) {
  if (!arenaCountdown) return;
  arenaCountdown.frozen.delete(playerId);
  if (arenaCountdown.frozen.size === 0) endCountdown();
}

function tickCountdown() {
  const cd = arenaCountdown;
  if (!cd) return;

  // hold everyone in place
  for (const [id, pos] of cd.frozen) {
    const p = findPlayerById(id);
    if (!p) {
      cd.frozen.delete(id);
      continue;
    }
    try {
      const l = p.location;
      const drift = Math.hypot(l.x - pos.x, l.z - pos.z);
      const limit = hardFrozen.has(id) ? 1.5 : 0.3; // locked players only get snapped if pushed far
      if (drift > limit || l.y < pos.y - 0.5) {
        p.teleport(pos, { keepVelocity: false });
      }
    } catch (e) {}
  }
  if (cd.frozen.size === 0) {
    endCountdown();
    return;
  }

  cd.tick++;
  if (cd.tick % 20 !== 0) return; // once per second

  cd.remaining--;
  if (cd.remaining > 0) {
    for (const id of cd.frozen.keys()) {
      const p = findPlayerById(id);
      if (p) showCountdownNumber(p, cd.remaining);
    }
    return;
  }

  // 0 = START: release everybody
  for (const id of cd.frozen.keys()) {
    const p = findPlayerById(id);
    if (!p) continue;
    unfreezeEffects(p);
    showStartLogo(p);
  }
  endCountdown();
}

function beginArenaCountdown(player, pos) {
  const freezePos = { x: pos.x, y: pos.y, z: pos.z };
  if (!arenaCountdown) {
    arenaCountdown = { remaining: COUNTDOWN_SECONDS, tick: 0, frozen: new Map() };
    countdownRunId = system.runInterval(tickCountdown, 1);
  }
  arenaCountdown.frozen.set(player.id, freezePos);
  freezeEffects(player);
  showCountdownNumber(player, arenaCountdown.remaining);
}

// ---------- Death / leaving: wipe everything so they can pick a new role ----------
function resetPlayerForNewGame(player) {
  unfreezeEffects(player);
  dropFromCountdown(player.id);
  try {
    for (const t of player.getTags()) {
      if (t.startsWith(ROLE_TAG_PREFIX)) player.removeTag(t); // forget the role
    }
  } catch (e) {}
  try {
    for (const ef of player.getEffects()) player.removeEffect(ef.typeId); // all attributes
  } catch (e) {}
  wipePlayerItems(player); // all items and armor
}

world.afterEvents.entityDie.subscribe((event) => {
  const dead = event.deadEntity;
  if (dead?.typeId !== "minecraft:player") return;
  try {
    handleMatchDeath(event); // kill credit + eliminated state, BEFORE the role tag is removed below
  } catch (e) {
    console.warn("[match] death handler failed: " + e);
  }
  try {
    resetPlayerForNewGame(dead);
  } catch (e) {}
});

world.afterEvents.playerLeave.subscribe((event) => {
  dropFromCountdown(event.playerId);
  system.run(checkAllArenas); // someone left mid-match: maybe a winner now
});

// ---------- Nobody can break (or place) blocks, in the arena or anywhere else ----------
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (BREAK_EXEMPT_TAG && event.player.hasTag(BREAK_EXEMPT_TAG)) return;
  event.cancel = true;
  const player = event.player;
  system.run(() => {
    try { player.onScreenDisplay.setActionBar("§cYou cannot break blocks here!"); } catch (e) {}
  });
});

try {
  world.beforeEvents.playerPlaceBlock.subscribe((event) => {
    if (BREAK_EXEMPT_TAG && event.player.hasTag(BREAK_EXEMPT_TAG)) return;
    event.cancel = true;
  });
} catch (e) {
}

// ---------- Arena border ----------
// Admins can leave with:  /tag @s add border_free   (remove with /tag @s remove border_free)
const BORDER_FREE_TAG = "border_free";
const borderLast = new Map(); // player id -> last position seen inside the arena

system.runInterval(() => {
  if (arenaBusy) return; // the builder moves around the arena on its own
  const arenas = getArenaList(); // the first arena + every copy
  for (const player of world.getAllPlayers()) {
    try {
      if (!player.dimension.id.includes("overworld")) {
        borderLast.delete(player.id);
        continue;
      }
      const p = player.location;
      let inArena = null;
      for (const ar of arenas) {
        if (p.x >= ar.cx - ARENA_HALF && p.x < ar.cx + ARENA_HALF && p.z >= ar.cz - ARENA_HALF && p.z < ar.cz + ARENA_HALF) {
          inArena = ar;
          break;
        }
      }
      if (inArena) {
        borderLast.set(player.id, { x: p.x, z: p.z, idx: inArena.index });
        continue;
      }
      const last = borderLast.get(player.id);
      if (!last) continue; // never was in an arena: normal world
      if (player.hasTag(BORDER_FREE_TAG) || Math.hypot(p.x - last.x, p.z - last.z) > 30) {
        borderLast.delete(player.id); // left on purpose (admin, respawn, teleport)
        continue;
      }
      const a = arenas[last.idx] ?? arenas[0];
      const x0 = a.cx - ARENA_HALF;
      const x1 = a.cx + ARENA_HALF;
      const z0 = a.cz - ARENA_HALF;
      const z1 = a.cz + ARENA_HALF;
      const nx = Math.min(Math.max(p.x, x0 + 1.5), x1 - 1.5);
      const nz = Math.min(Math.max(p.z, z0 + 1.5), z1 - 1.5);
      player.teleport({ x: nx, y: p.y, z: nz });
      try {
        player.clearVelocity();
      } catch (e) {}
      player.onScreenDisplay.setActionBar("§cYou cannot leave the arena!");
    } catch (e) {}
  }
}, 2);

// ---------- Floating text title (TITLE_MODE "text") ----------
const TITLE_TAG = "arena_title_text";

function ensureTitleText() {
  if (!ARENA_TITLE) return;
  try {
    const dim = world.getDimension(DIMENSION);

    // Not in text mode: delete any leftover floating title so only the block letters remain
    if (TITLE_MODE !== "text") {
      for (const e of dim.getEntities({ tags: [TITLE_TAG] })) e.remove();
      return;
    }

    const a = getActiveArena();
    const pos = { x: a.cx + 0.5, y: a.fy + TITLE_TEXT_HEIGHT, z: a.cz + 0.5 };
    if (!dim.getBlock(pos)) return; // wait until the chunk is loaded

    const text = TITLE_TEXT_COLOR + ARENA_TITLE;
    const found = dim.getEntities({ tags: [TITLE_TAG] });
    let title;
    if (found.length === 0) {
      title = dim.spawnEntity("jester:label", pos);
      title.addTag(TITLE_TAG);
      title.addTag(LABEL_TAG);
    } else {
      title = found[0];
      for (let i = 1; i < found.length; i++) found[i].remove();
    }
    if (title.nameTag !== text) title.nameTag = text;
    const d = Math.hypot(title.location.x - pos.x, title.location.y - pos.y, title.location.z - pos.z);
    if (d > 0.1) title.teleport(pos);
  } catch (e) {
    console.warn("[arena] title text failed: " + e);
  }
}
system.runInterval(ensureTitleText, 40);

// Small seeded random generator, so the same seed builds the same ruins
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z, s) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, s);
  const b = hash2(x0 + 1, z0, s);
  const c = hash2(x0, z0 + 1, s);
  const d = hash2(x0 + 1, z0 + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Builds the whole arena as a list of commands, grouped into sections.
// Pure function (no game calls), so it can be tested outside Minecraft.
function generateArena(cx, cz, fy, seed, titleOnly = false) {
  const N = ARENA_SIZE;
  const S = ARENA_SECTION;
  const per = N / S;
  const X0 = cx - ARENA_HALF;
  const X1 = cx + ARENA_HALF - 1;
  const Z0 = cz - ARENA_HALF;
  const Z1 = cz + ARENA_HALF - 1;

  const rnd = makeRng(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p) => rnd() < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);

  const AIR = "minecraft:air";

  // ---------- sections + command emitters ----------
  const sections = [];
  for (let sz = 0; sz < per; sz++) {
    for (let sx = 0; sx < per; sx++) {
      sections.push({
        x0: X0 + sx * S,
        x1: X0 + (sx + 1) * S - 1,
        z0: Z0 + sz * S,
        z1: Z0 + (sz + 1) * S - 1,
        ops: [],
      });
    }
  }
  let totalCost = 0;
  let recording = !titleOnly; // in title-only mode nothing is recorded until the title section
  const addOp = (sec, cmd, cost) => {
    if (!recording) return;
    sec.ops.push([cmd, cost]);
    totalCost += cost;
  };

  const set = (x, y, z, block, mode = "") => {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
    const sec = sections[Math.floor((z - Z0) / S) * per + Math.floor((x - X0) / S)];
    addOp(sec, `setblock ${x} ${y} ${z} ${block}${mode ? " " + mode : ""}`, 1);
  };

  const fill = (x1, y1, z1, x2, y2, z2, block, mode = "") => {
    const ax = Math.max(Math.min(x1, x2), X0);
    const bx = Math.min(Math.max(x1, x2), X1);
    const az = Math.max(Math.min(z1, z2), Z0);
    const bz = Math.min(Math.max(z1, z2), Z1);
    const ay = Math.min(y1, y2);
    const by = Math.max(y1, y2);
    if (ax > bx || az > bz) return;
    const sx0 = Math.floor((ax - X0) / S);
    const sx1 = Math.floor((bx - X0) / S);
    const sz0 = Math.floor((az - Z0) / S);
    const sz1 = Math.floor((bz - Z0) / S);
    for (let sz = sz0; sz <= sz1; sz++) {
      for (let sx = sx0; sx <= sx1; sx++) {
        const px0 = Math.max(ax, X0 + sx * S);
        const px1 = Math.min(bx, X0 + (sx + 1) * S - 1);
        const pz0 = Math.max(az, Z0 + sz * S);
        const pz1 = Math.min(bz, Z0 + (sz + 1) * S - 1);
        const area = (px1 - px0 + 1) * (pz1 - pz0 + 1);
        const step = Math.max(1, Math.floor(32000 / area)); // fill limit is 32768 blocks
        for (let y = ay; y <= by; y += step) {
          const ye = Math.min(by, y + step - 1);
          const vol = area * (ye - y + 1);
          addOp(
            sections[sz * per + sx],
            `fill ${px0} ${y} ${pz0} ${px1} ${ye} ${pz1} ${block}${mode ? " " + mode : ""}`,
            1 + Math.floor(vol / 3000)
          );
        }
      }
    }
  };

  const disc = (x, z, r, y1, y2, block) => {
    for (let dz = -r; dz <= r; dz++) {
      const w = Math.floor(Math.sqrt(r * r - dz * dz));
      fill(x - w, y1, z + dz, x + w, y2, z + dz, block);
    }
  };

  // ---------- material lists ----------
  const MIX_STONE = [
    "minecraft:stone_bricks",
    "minecraft:stone_bricks",
    "minecraft:cracked_stone_bricks",
    "minecraft:mossy_stone_bricks",
    "minecraft:cobblestone",
    "minecraft:mossy_cobblestone",
  ];
  const WEAR = [
    "minecraft:cracked_stone_bricks",
    "minecraft:mossy_stone_bricks",
    "minecraft:cobblestone",
    "minecraft:mossy_cobblestone",
    "minecraft:andesite",
  ];
  const MIX_WOOD = [
    "minecraft:oak_planks",
    "minecraft:oak_planks",
    "minecraft:spruce_planks",
    "minecraft:dark_oak_planks",
    "minecraft:stripped_oak_log",
  ];
  const INTERIOR = [
    "minecraft:crafting_table",
    "minecraft:barrel",
    "minecraft:chest",
    "minecraft:web",
    "minecraft:bookshelf",
    "minecraft:cauldron",
    "minecraft:hay_block",
    "minecraft:furnace",
  ];

  // ---------- generic building helpers ----------

  // Four-sided solid ring of walls (thick layers)
  const solidRing = (x1, z1, x2, z2, y1, y2, thick, block) => {
    for (let t = 0; t < thick; t++) {
      const a = x1 + t;
      const b = x2 - t;
      const c = z1 + t;
      const d = z2 - t;
      if (a > b || c > d) break;
      fill(a, y1, c, b, y2, c, block);
      if (d > c) fill(a, y1, d, b, y2, d, block);
      if (d - c > 1) {
        fill(a, y1, c + 1, a, y2, d - 1, block);
        if (b > a) fill(b, y1, c + 1, b, y2, d - 1, block);
      }
    }
  };

  // Walls with random broken tops. y0 = floor layer, H = wall height, ruin = 0..1.
  // gaps: [{ side: "N"|"S"|"W"|"E", c: center coordinate, w: width, h: door height (optional) }]
  const ruinedWalls = (x1, z1, x2, z2, y0, H, thick, mix, ruin, gaps) => {
    const gapAt = (x, z, side) => {
      for (const g of gaps) {
        if (g.side !== side) continue;
        const v = side === "N" || side === "S" ? x : z;
        const lo = g.c - Math.floor(g.w / 2);
        if (v >= lo && v < lo + g.w) return g;
      }
      return null;
    };
    const col = (x, z, side) => {
      let h = H;
      if (chance(ruin)) h = Math.max(1, Math.floor(H * rnd()));
      else if (chance(0.3)) h = Math.max(1, H - rint(1, 2));
      const g = gapAt(x, z, side);
      if (g) {
        if (g.h === undefined || h <= g.h) return;
        fill(x, y0 + g.h + 1, z, x, y0 + h, z, pick(mix));
        return;
      }
      fill(x, y0 + 1, z, x, y0 + h, z, pick(mix));
    };
    for (let t = 0; t < thick; t++) {
      const a = x1 + t;
      const b = x2 - t;
      const c = z1 + t;
      const d = z2 - t;
      if (a > b || c > d) break;
      for (let x = a; x <= b; x++) {
        col(x, c, "N");
        if (d > c) col(x, d, "S");
      }
      for (let z = c + 1; z <= d - 1; z++) {
        col(a, z, "W");
        if (b > a) col(b, z, "E");
      }
    }
  };

  const lamp = (x, z) => {
    fill(x, fy + 1, z, x, fy + 3, z, "minecraft:cobblestone_wall");
    set(x, fy + 4, z, "minecraft:lantern");
  };

  const debris = (x0, z0, x1, z1, n, blocks) => {
    for (let i = 0; i < n; i++) {
      const x = rint(x0 - 3, x1 + 3);
      const z = rint(z0 - 3, z1 + 3);
      if (x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1) continue;
      set(x, fy + 1, z, pick(blocks), "keep");
    }
  };

  // Ruined stone tower. s = size, H = height, floors = heights of inside floors.
  const tower = (x0, z0, s, H, o = {}) => {
    const x1 = x0 + s - 1;
    const z1 = z0 + s - 1;
    const th = o.th ?? (s >= 9 ? 2 : 1);
    const mix = o.mix ?? MIX_STONE;
    const floors = o.floors ?? [];
    const keepH = Math.max(3, H - 5);
    const xm = x0 + Math.floor(s / 2);
    const zm = z0 + Math.floor(s / 2);

    fill(x0, fy + 1, z0, x1, fy + H + 2, z1, AIR);
    solidRing(x0, z0, x1, z1, fy + 1, fy + keepH, th, "minecraft:stone_bricks");
    ruinedWalls(x0, z0, x1, z1, fy + keepH, H - keepH, th, mix, o.ruin ?? 0.55, []);

    for (let n = 0; n < s * 2; n++) {
      const side = rint(0, 3);
      const y = fy + rint(1, keepH);
      if (side === 0) set(rint(x0, x1), y, z0, pick(WEAR));
      else if (side === 1) set(rint(x0, x1), y, z1, pick(WEAR));
      else if (side === 2) set(x0, y, rint(z0, z1), pick(WEAR));
      else set(x1, y, rint(z0, z1), pick(WEAR));
    }

    for (const f of floors) {
      fill(x0 + th, fy + f, z0 + th, x1 - th, fy + f, z1 - th, "minecraft:spruce_planks");
      for (let n = 0; n < 3; n++) set(rint(x0 + th, x1 - th), fy + f, rint(z0 + th, z1 - th), AIR);
    }
    if (floors.length) {
      const top = Math.max(...floors);
      // one block off the arrow slit (and the north door) so the ladder always has a wall behind it
      fill(xm + 1, fy + 1, z0 + th, xm + 1, fy + top, z0 + th, 'minecraft:ladder ["facing_direction"=3]');
      set(x0 + th, fy + top + 1, z1 - th, "minecraft:soul_lantern");
    }

    // door
    const door = o.door === undefined ? "S" : o.door;
    if (door === "S") fill(xm - 1, fy + 1, z1 - th + 1, xm, fy + 3, z1, AIR);
    else if (door === "N") fill(xm - 1, fy + 1, z0, xm, fy + 3, z0 + th - 1, AIR);
    else if (door === "W") fill(x0, fy + 1, zm - 1, x0 + th - 1, fy + 3, zm, AIR);
    else if (door === "E") fill(x1 - th + 1, fy + 1, zm - 1, x1, fy + 3, zm, AIR);

    // arrow slits
    for (const f of [3, ...floors]) {
      const ya = fy + f + 1;
      const yb = fy + f + 2;
      if (ya + 1 > fy + keepH) continue;
      if (door !== "N") fill(xm, ya, z0, xm, yb, z0 + th - 1, AIR);
      if (door !== "S") fill(xm, ya, z1 - th + 1, xm, yb, z1, AIR);
      if (door !== "W") fill(x0, ya, zm, x0 + th - 1, yb, zm, AIR);
      if (door !== "E") fill(x1 - th + 1, ya, zm, x1, yb, zm, AIR);
    }

    debris(x0, z0, x1, z1, s + 4, ["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:stone_bricks"]);
  };

  // House (ruined wood or stone). door = "N"|"S"|"W"|"E". st = style.
  const house = (x0, z0, w, d, door, st) => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const H = st.H;
    const xm = x0 + Math.floor(w / 2);
    const zm = z0 + Math.floor(d / 2);

    fill(x0, fy, z0, x1, fy, z1, st.floor);
    for (let n = 0; n < Math.floor((w * d) / 16); n++) {
      set(rint(x0 + 1, x1 - 1), fy, rint(z0 + 1, z1 - 1), pick(["minecraft:grass_block", "minecraft:moss_block", "minecraft:coarse_dirt"]));
    }

    const gc = door === "N" || door === "S" ? xm : zm;
    ruinedWalls(x0, z0, x1, z1, fy, H, 1, st.mix, st.ruin, [{ side: door, c: gc, w: st.doorW, h: st.doorH }]);

    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      if (!chance(0.8)) rint(2, H); // keeps the random sequence (and the layout) identical
      fill(x, fy + 1, z, x, fy + H, z, st.post);
    }

    // top plate: a continuous beam under the roof so it is always held up
    fill(x0, fy + H, z0, x1, fy + H, z0, st.post);
    fill(x0, fy + H, z1, x1, fy + H, z1, st.post);
    fill(x0, fy + H, z0, x0, fy + H, z1, st.post);
    fill(x1, fy + H, z0, x1, fy + H, z1, st.post);

    if (st.windows) {
      for (let x = x0 + 2; x <= x1 - 2; x += 3) {
        if (door !== "N") set(x, fy + 2, z0, AIR);
        if (door !== "S") set(x, fy + 2, z1, AIR);
      }
      for (let z = z0 + 2; z <= z1 - 2; z += 3) {
        if (door !== "W") set(x0, fy + 2, z, AIR);
        if (door !== "E") set(x1, fy + 2, z, AIR);
      }
    }

    // stepped roof, broken in places
    const ridgeX = w >= d;
    const a0 = (ridgeX ? x0 : z0) - 1;
    const a1 = (ridgeX ? x1 : z1) + 1;
    let lo = (ridgeX ? z0 : x0) - 1;
    let hi = (ridgeX ? z1 : x1) + 1;
    let prev = new Set(); // positions along the ridge that have roof on the layer below
    for (let k = 0; lo <= hi; k++, lo++, hi--) {
      const y = fy + H + 1 + k;
      const cur = new Set();
      let a = a0;
      while (a <= a1) {
        const b = Math.min(a1, a + rint(2, 4) - 1);
        const lost = chance(st.roofLoss + 0.06 * k);
        let held = k === 0;
        for (let q = a; q <= b && !held; q++) if (prev.has(q)) held = true;
        if (!lost && held) {
          if (ridgeX) fill(a, y, lo, b, y, hi, st.roof);
          else fill(lo, y, a, hi, y, b, st.roof);
          for (let q = a; q <= b; q++) cur.add(q);
        }
        a = b + 1;
      }
      prev = cur;
    }

    for (let n = 0; n < st.items; n++) {
      set(rint(x0 + 1, x1 - 1), fy + 1, rint(z0 + 1, z1 - 1), pick(st.interior ?? INTERIOR));
    }
    if (st.chimney) {
      const cxp = door === "E" ? x0 - 1 : x1 + 1;
      fill(cxp, fy + 1, zm, cxp, fy + H + rint(2, 4), zm, "minecraft:cobblestone");
    }
    debris(x0, z0, x1, z1, st.debris, st.debrisBlocks);
  };

  const woodStyle = () => ({
    H: rint(4, 5),
    mix: MIX_WOOD,
    post: "minecraft:oak_log",
    roof: pick(["minecraft:spruce_planks", "minecraft:dark_oak_planks", "minecraft:oak_planks"]),
    floor: "minecraft:spruce_planks",
    ruin: 0.35,
    roofLoss: 0.28,
    items: 3,
    doorW: 2,
    doorH: 3,
    windows: true,
    chimney: false,
    debris: 10,
    debrisBlocks: ["minecraft:oak_planks", "minecraft:oak_log", "minecraft:oak_fence", "minecraft:spruce_planks", "minecraft:cobblestone"],
  });
  const stoneStyle = () => ({
    H: rint(5, 6),
    mix: MIX_STONE,
    post: "minecraft:dark_oak_log",
    roof: pick(["minecraft:dark_oak_planks", "minecraft:spruce_planks"]),
    floor: "minecraft:cobblestone",
    ruin: 0.3,
    roofLoss: 0.35,
    items: 3,
    doorW: 2,
    doorH: 3,
    windows: true,
    chimney: true,
    debris: 10,
    debrisBlocks: ["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:stone_bricks", "minecraft:gravel"],
  });
  const barnStyle = () => ({
    ...woodStyle(),
    H: 6,
    doorW: 5,
    doorH: 4,
    windows: false,
    items: 6,
    interior: ["minecraft:hay_block", "minecraft:hay_block", "minecraft:barrel", "minecraft:web", "minecraft:chest"],
    roofLoss: 0.4,
  });

  const chapel = (x0, z0, w, d, door) => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const xm = x0 + Math.floor(w / 2);
    fill(x0, fy, z0, x1, fy, z1, "minecraft:stone_bricks");
    for (let n = 0; n < w * d * 0.15; n++) set(rint(x0, x1), fy, rint(z0, z1), pick(WEAR));
    ruinedWalls(x0, z0, x1, z1, fy, 9, 1, MIX_STONE, 0.3, [{ side: door, c: xm, w: 3, h: 4 }]);
    for (let z = z0 + 3; z <= z1 - 3; z += 4) {
      fill(x0, fy + 3, z, x0, fy + 6, z, AIR);
      fill(x1, fy + 3, z, x1, fy + 6, z, AIR);
    }
    const farZ = door === "S" ? z0 : z1 - 4;
    tower(x0, farZ, 5, 16, { floors: [8], ruin: 0.6, door: door });
    const zf = door === "S" ? z0 + 1 : z1 - 1;
    for (let dx = 1; dx <= 3; dx++) set(xm + dx, fy + 1, zf, "minecraft:polished_andesite");
    set(xm + 2, fy + 2, zf, "minecraft:soul_lantern");
    for (let z = z0 + 2; z <= z1 - 2; z += 2) {
      const nearEnd = door === "S" ? z > z0 + 6 : z < z1 - 6;
      if (!nearEnd) continue;
      for (const x of [xm - 3, xm - 2, xm + 2, xm + 3]) if (chance(0.75)) set(x, fy + 1, z, "minecraft:oak_slab");
    }
    set(xm, fy + 1, z0 + Math.floor(d / 2), "minecraft:web");
    debris(x0, z0, x1, z1, 14, ["minecraft:stone_bricks", "minecraft:cracked_stone_bricks", "minecraft:cobblestone"]);
  };

  const smith = (x0, z0, w, d, door) => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const xm = x0 + Math.floor(w / 2);
    const zm = z0 + Math.floor(d / 2);
    fill(x0, fy, z0, x1, fy, z1, "minecraft:cobblestone");
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      rint(3, 4); // keeps the random sequence (and the layout) identical
      fill(x, fy + 1, z, x, fy + 4, z, "minecraft:oak_log");
    }
    // back wall opposite the door
    if (door === "S") fill(x0, fy + 1, z0, x1, fy + 3, z0, "minecraft:cobblestone");
    else fill(x0, fy + 1, z1, x1, fy + 3, z1, "minecraft:cobblestone");
    // beam frame joined to the posts: long beams on both sides + a cross beam every 2 blocks
    fill(x0, fy + 4, z0, x1, fy + 4, z0, "minecraft:oak_planks");
    fill(x0, fy + 4, z1, x1, fy + 4, z1, "minecraft:oak_planks");
    for (let x = x0; x <= x1; x += 2) fill(x, fy + 4, z0, x, fy + 4, z1, "minecraft:oak_planks");
    // (these draws only keep the random sequence identical)
    for (let x = x0; x <= x1; x += 2) {
      for (const z of [z0, z1]) chance(0.55);
    }
    // roof slabs only where a beam is underneath
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const c = chance(0.35);
      if (c && ((x - x0) % 2 === 0 || z === z0 || z === z1)) set(x, fy + 5, z, "minecraft:oak_slab");
    }
    set(xm, fy + 1, zm, "minecraft:anvil");
    set(xm + 2, fy + 1, zm, "minecraft:furnace");
    set(xm - 2, fy + 1, zm, "minecraft:cauldron");
    set(xm, fy + 1, door === "S" ? z0 + 1 : z1 - 1, "minecraft:grindstone");
    set(x1 - 1, fy + 1, door === "S" ? z0 + 1 : z1 - 1, "minecraft:barrel");
    fill(x1 + 1, fy + 1, zm, x1 + 1, fy + 6, zm, "minecraft:cobblestone");
    debris(x0, z0, x1, z1, 8, ["minecraft:cobblestone", "minecraft:oak_planks", "minecraft:gravel"]);
  };

  const stall = (x, z) => {
    for (const [px, pz] of [[x, z], [x + 2, z], [x, z + 2], [x + 2, z + 2]]) {
      fill(px, fy + 1, pz, px, fy + 2, pz, "minecraft:oak_fence");
    }
    const cloth = pick(["minecraft:red_wool", "minecraft:white_wool", "minecraft:orange_wool", "minecraft:blue_wool"]);
    for (let dx = 0; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) {
      const c = chance(0.7);
      const corner = dx !== 1 && dz !== 1;
      if (c || corner) set(x + dx, fy + 3, z + dz, dx === 1 ? "minecraft:white_wool" : cloth);
    }
    set(x + 1, fy + 1, z + 1, pick(["minecraft:barrel", "minecraft:hay_block", "minecraft:chest"]));
    set(x + 1, fy + 1, z + 2, "minecraft:oak_slab");
  };

  const well = (x, z) => {
    fill(x - 1, fy + 1, z - 1, x + 1, fy + 1, z + 1, "minecraft:cobblestone");
    set(x, fy + 1, z, "minecraft:water");
    const posts = new Set();
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (chance(0.85)) {
        fill(x + dx, fy + 2, z + dz, x + dx, fy + 3, z + dz, "minecraft:cobblestone_wall");
        posts.add(`${dx},${dz}`);
      }
    }
    // roof slabs only where they are held up: corners on posts, edges and middle touching a placed slab
    const want = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) want.set(`${dx},${dz}`, chance(0.55));
    const roof = new Set(posts);
    const edges = [[0, -1], [-1, 0], [1, 0], [0, 1]];
    for (const [dx, dz] of edges) {
      const near = dx === 0 ? [[-1, dz], [1, dz]] : [[dx, -1], [dx, 1]];
      if (want.get(`${dx},${dz}`) && near.some(([a, b]) => roof.has(`${a},${b}`))) roof.add(`${dx},${dz}`);
    }
    if (want.get("0,0") && edges.some(([a, b]) => roof.has(`${a},${b}`))) roof.add("0,0");
    for (const key of roof) {
      const [dx, dz] = key.split(",").map(Number);
      set(x + dx, fy + 4, z + dz, "minecraft:oak_slab");
    }
  };

  const farm = (x0, z0, w, d) => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const xm = x0 + Math.floor(w / 2);
    fill(x0, fy, z0, x1, fy, z1, "minecraft:farmland");
    fill(xm, fy, z0, xm, fy, z1, "minecraft:water");
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (x === xm) continue;
      if (chance(0.55)) set(x, fy + 1, z, `minecraft:wheat ["growth"=${rint(0, 7)}]`);
    }
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (chance(0.7)) set(x, fy + 1, z0 - 1, "minecraft:oak_fence");
      if (chance(0.7)) set(x, fy + 1, z1 + 1, "minecraft:oak_fence");
    }
    for (let z = z0; z <= z1; z++) {
      if (chance(0.7)) set(x0 - 1, fy + 1, z, "minecraft:oak_fence");
      if (chance(0.7)) set(x1 + 1, fy + 1, z, "minecraft:oak_fence");
    }
    set(x1, fy + 1, z1, "minecraft:hay_block");
    set(x0, fy + 1, z0, "minecraft:hay_block");
  };

  const graveyard = (x0, z0, w, d, door) => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const xm = x0 + Math.floor(w / 2);
    const zm = z0 + Math.floor(d / 2);
    const gc = door === "N" || door === "S" ? xm : zm;
    ruinedWalls(x0, z0, x1, z1, fy, 2, 1, ["minecraft:cobblestone_wall", "minecraft:mossy_cobblestone_wall"], 0.35, [{ side: door, c: gc, w: 3 }]);
    for (let x = x0 + 2; x <= x1 - 2; x += 3) {
      for (let z = z0 + 2; z <= z1 - 2; z += 3) {
        if (x === xm) continue;
        if (chance(0.8)) {
          set(x, fy + 1, z, "minecraft:cobblestone_wall");
          set(x, fy + 2, z, chance(0.5) ? "minecraft:stone_brick_slab" : AIR);
          set(x, fy, z + 1, "minecraft:coarse_dirt");
        }
      }
    }
    set(x1 - 1, fy + 1, z0 + 1, "minecraft:soul_lantern");
    set(x0 + 1, fy + 1, z1 - 1, "minecraft:web");
  };

  // Wooden lookout tower
  const woodTower = (x0, z0, s, H) => {
    const x1 = x0 + s - 1;
    const z1 = z0 + s - 1;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      fill(x, fy + 1, z, x, fy + (chance(0.8) ? H : rint(4, H)), z, "minecraft:oak_log");
    }
    for (const y of [4, 8]) {
      for (let x = x0 + 1; x <= x1 - 1; x++) {
        if (chance(0.8)) set(x, fy + y, z0, "minecraft:oak_fence");
        if (chance(0.8)) set(x, fy + y, z1, "minecraft:oak_fence");
      }
      for (let z = z0 + 1; z <= z1 - 1; z++) {
        if (chance(0.8)) set(x0, fy + y, z, "minecraft:oak_fence");
        if (chance(0.8)) set(x1, fy + y, z, "minecraft:oak_fence");
      }
    }
    fill(x0, fy + H, z0, x1, fy + H, z1, "minecraft:spruce_planks");
    for (let n = 0; n < 4; n++) set(rint(x0, x1), fy + H, rint(z0, z1), AIR);
    const xm = x0 + Math.floor(s / 2);
    fill(xm, fy + 1, z0, xm, fy + H, z0, "minecraft:oak_log"); // the ladder needs a solid block behind it
    fill(xm, fy + 1, z0 + 1, xm, fy + H, z0 + 1, 'minecraft:ladder ["facing_direction"=3]');
    for (let x = x0; x <= x1; x++) {
      for (const z of [z0, z1]) if (chance(0.6)) set(x, fy + H + 1, z, "minecraft:oak_fence");
    }
    set(x0 + 1, fy + H + 1, z1 - 1, "minecraft:lantern");
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      fill(x, fy + H + 1, z, x, fy + H + 3, z, "minecraft:oak_fence");
    }
    // roof frame: the outer ring is always there, the ring inside it is partly there,
    // and the corners sit on the posts, so every slab touches another one
    for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) {
      const c = chance(0.25);
      const outer = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
      const inner = x === x0 || x === x1 || z === z0 || z === z1;
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      if (outer || corner || (inner && c)) set(x, fy + H + 4, z, "minecraft:spruce_slab");
    }
  };

  const boulder = (x, z, gy) => {
    const b = () => pick(["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:andesite", "minecraft:stone"]);
    const r = rint(1, 2);
    fill(x, gy + 1, z, x + r, gy + r, z + r, b());
    fill(x - 1, gy + 1, z, x, gy + 1, z + 1, b());
    if (chance(0.5)) set(x + 1, gy + r + 1, z + 1, b());
  };

  // =====================================================================
  // UPGRADE A: new helpers (forest trees, small ruins, outposts, banners, wildlife)
  // =====================================================================

  // Hand-placed outposts: [x, z, kind, flat radius], relative to the arena center.
  const OUTPOSTS = [
    [46, -58, "ruintower", 13],
    [-46, 58, "stones", 11],
    [46, 58, "camp", 13],
    [-46, -58, "cabin", 12],
    [110, -40, "watch", 10],
    [-110, 45, "shrine", 11],
    [-45, -105, "hamlet", 14],
    [45, 100, "obelisk", 11],
  ];

  // The four big PvP castles, one per corner: [x, z, team color], relative to the arena center
  const CASTLES = [
    [-126, -126, "blue"],
    [126, -126, "red"],
    [-126, 126, "lime"],
    [126, 126, "yellow"],
  ];

  // Cells where a trunk or ruin stands (plants and animals stay away from them)
  const treeCells = new Uint8Array(N * N);
  const markCells = (x, z, r) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const xi = x + dx - X0;
        const zi = z + dz - Z0;
        if (xi >= 0 && xi < N && zi >= 0 && zi < N) treeCells[zi * N + xi] = 1;
      }
    }
  };

  // persistent_bit = leaves never decay, so trees can no longer fall apart by themselves
  const LEAF = (kind) => `minecraft:${kind}_leaves ["persistent_bit"=true]`;
  const crossAt = (x, y, z, r, kind) => {
    fill(x - r, y, z - (r - 1), x + r, y, z + (r - 1), LEAF(kind), "keep");
    fill(x - (r - 1), y, z - r, x + (r - 1), y, z + r, LEAF(kind), "keep");
  };

  // Full, solid trees: oak, birch, spruce, big dark oak, or a dead tree
  const forestTree = (x, z, gy, kind) => {
    const k = kind ?? pick(["oak", "oak", "birch", "spruce", "spruce", "spruce", "dark"]);
    markCells(x, z, 1);
    if (k === "oak" || k === "birch") {
      const h = k === "oak" ? rint(5, 7) : rint(6, 8);
      const top = gy + h;
      crossAt(x, top - 2, z, 2, k);
      crossAt(x, top - 1, z, 2, k);
      fill(x - 1, top, z - 1, x + 1, top, z + 1, LEAF(k), "keep");
      crossAt(x, top + 1, z, 1, k);
      for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        if (chance(0.4)) set(x + ox, top - 1, z + oz, LEAF(k), "keep");
      }
      fill(x, gy + 1, z, x, top, z, k === "oak" ? "minecraft:oak_log" : "minecraft:birch_log");
    } else if (k === "dark") {
      const h = rint(8, 12);
      const top = gy + h;
      const layer = (y, r) => {
        for (let dz = -r; dz <= r + 1; dz++) {
          const dd = dz <= 0 ? dz : dz - 1;
          const half = Math.floor(Math.sqrt(r * r - dd * dd) + 0.4);
          fill(x - half, y, z + dz, x + 1 + half, y, z + dz, LEAF("dark_oak"), "keep");
        }
      };
      layer(top - 3, 3);
      layer(top - 2, 4);
      layer(top - 1, 4);
      layer(top, 3);
      layer(top + 1, 2);
      fill(x, gy + 1, z, x + 1, top + 1, z + 1, "minecraft:dark_oak_log");
    } else if (k === "spruce") {
      const h = rint(8, 13);
      const top = gy + h;
      const R = [0, 1, 1, 2, 2, 3, 2, 3, 3, 4, 3, 4];
      const rmax = h >= 11 ? 4 : 3;
      for (let y = top + 1; y >= gy + 3; y--) {
        const d = top + 1 - y;
        const r = Math.min(R[Math.min(d, R.length - 1)], rmax);
        if (r === 0) set(x, y, z, LEAF("spruce"), "keep");
        else crossAt(x, y, z, r, "spruce");
      }
      fill(x, gy + 1, z, x, top, z, "minecraft:spruce_log");
    } else {
      // dead oak (branches are joined to the trunk, leaves never decay)
      const h = rint(4, 8);
      fill(x, gy + 1, z, x, gy + h, z, "minecraft:oak_log");
      for (let b = 0; b < 3; b++) {
        const dx = rint(-1, 1);
        const dz = rint(-1, 1);
        if (!dx && !dz) continue;
        const by = gy + h - rint(1, 3);
        set(x + dx, by, z + dz, "minecraft:oak_log");
        if (dx && dz) set(x + dx, by, z, "minecraft:oak_log");
        set(x + dx, by + 1, z + dz, "minecraft:oak_log");
        if (dx && dz) set(x + dx * 2, by + 1, z + dz, "minecraft:oak_log");
        set(x + dx * 2, by + 1, z + dz * 2, "minecraft:oak_log");
        if (chance(0.6)) set(x + dx * 2, by + 2, z + dz * 2, LEAF("oak"), "keep");
      }
      set(x, gy + h + 1, z, LEAF("oak"), "keep");
    }
  };

  // Small ruins and props scattered over open ground (gy = ground layer under it)
  const smallRuin = (x, z, gy) => {
    const kind = pick(["arch", "pillars", "cairn", "log", "camp", "hay", "grave", "cart", "lamp", "arch", "pillars"]);
    const stone = () => pick(["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cracked_stone_bricks", "minecraft:mossy_cobblestone"]);
    markCells(x + 2, z, 4);
    switch (kind) {
      case "arch": {
        const h = rint(4, 6);
        const lintel = chance(0.6);
        fill(x, gy + 1, z, x, gy + h, z, stone());
        fill(x + 4, gy + 1, z, x + 4, gy + (lintel ? h : rint(2, h)), z, stone());
        if (lintel) fill(x, gy + h + 1, z, x + 4, gy + h + 1, z, stone());
        break;
      }
      case "pillars": {
        for (let n = rint(3, 5); n > 0; n--) {
          const px = x + rint(-3, 3);
          const pz = z + rint(-3, 3);
          fill(px, gy + 1, pz, px, gy + rint(2, 6), pz, stone());
          set(px + 1, gy + 1, pz, "minecraft:cobblestone", "keep");
        }
        break;
      }
      case "cairn": {
        fill(x - 1, gy + 1, z - 1, x + 1, gy + 1, z + 1, "minecraft:cobblestone");
        fill(x, gy + 2, z, x, gy + 3, z, "minecraft:mossy_cobblestone");
        if (chance(0.5)) set(x, gy + 4, z, "minecraft:lantern");
        break;
      }
      case "log":
        fill(x, gy + 1, z, x + 4, gy + 1, z, 'minecraft:oak_log ["pillar_axis"="x"]');
        break;
      case "camp":
        set(x, gy + 1, z, "minecraft:campfire");
        set(x + 2, gy + 1, z, "minecraft:hay_block");
        set(x - 2, gy + 1, z + 1, "minecraft:barrel");
        set(x, gy + 1, z + 2, "minecraft:hay_block");
        break;
      case "hay":
        fill(x, gy + 1, z, x + 1, gy + 1, z + 1, "minecraft:hay_block");
        set(x, gy + 2, z, "minecraft:hay_block");
        break;
      case "grave":
        for (let i = 0; i < 3; i++) {
          set(x + i * 2, gy + 1, z, "minecraft:cobblestone_wall");
          set(x + i * 2, gy + 2, z, "minecraft:stone_brick_slab");
        }
        break;
      case "cart":
        fill(x, gy + 1, z, x, gy + 1, z + 1, "minecraft:oak_fence");
        fill(x + 3, gy + 1, z, x + 3, gy + 1, z + 1, "minecraft:oak_fence");
        fill(x, gy + 2, z, x + 3, gy + 2, z + 1, "minecraft:spruce_planks");
        set(x + 1, gy + 3, z, "minecraft:hay_block");
        set(x + 2, gy + 3, z + 1, "minecraft:barrel");
        break;
      default:
        fill(x, gy + 1, z, x, gy + 3, z, "minecraft:cobblestone_wall");
        set(x, gy + 4, z, "minecraft:lantern");
    }
  };

  // Banner pole (flag hangs to the +x side)
  const flag = (x, z, h, wool) => {
    fill(x, fy + 1, z, x, fy + h, z, "minecraft:oak_fence");
    fill(x + 1, fy + h - 3, z, x + 3, fy + h - 1, z, wool);
    set(x, fy + h + 1, z, "minecraft:lantern");
  };

  const tent = (x, z, wool) => {
    fill(x, fy + 1, z, x + 4, fy + 1, z, wool);
    fill(x, fy + 1, z + 4, x + 4, fy + 1, z + 4, wool);
    fill(x, fy + 2, z + 1, x + 4, fy + 2, z + 1, wool);
    fill(x, fy + 2, z + 3, x + 4, fy + 2, z + 3, wool);
    fill(x, fy + 3, z + 2, x + 4, fy + 3, z + 2, wool);
    set(x + 1, fy + 1, z + 2, "minecraft:hay_block");
    set(x + 3, fy + 1, z + 2, chance(0.5) ? "minecraft:chest" : "minecraft:barrel");
  };

  const banditCamp = (x, z) => {
    disc(x, z, 4, fy, fy, "minecraft:coarse_dirt");
    tent(x - 9, z - 9, "minecraft:red_wool");
    tent(x + 4, z - 9, "minecraft:brown_wool");
    tent(x - 3, z + 5, "minecraft:gray_wool");
    set(x, fy + 1, z, "minecraft:campfire");
    for (const [ox, oz] of [[-2, 0], [2, 0], [0, 2], [0, -2]]) set(x + ox, fy + 1, z + oz, "minecraft:hay_block");
    set(x + 3, fy + 1, z + 3, "minecraft:barrel");
    set(x - 3, fy + 1, z - 3, "minecraft:chest");
    flag(x + 6, z + 6, 8, "minecraft:red_wool");
    debris(x - 8, z - 8, x + 8, z + 8, 8, ["minecraft:oak_planks", "minecraft:hay_block", "minecraft:cobblestone"]);
  };

  const standingStones = (x, z) => {
    disc(x, z, 9, fy, fy, "minecraft:coarse_dirt");
    disc(x, z, 7, fy, fy, "minecraft:mossy_cobblestone");
    disc(x, z, 2, fy, fy, "minecraft:polished_blackstone_bricks");
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      const px = Math.round(x + Math.cos(ang) * 7);
      const pz = Math.round(z + Math.sin(ang) * 7);
      const h = chance(0.3) ? rint(2, 3) : rint(4, 6);
      fill(px, fy + 1, pz, px, fy + h, pz, pick(["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cobblestone"]));
      if (h >= 4 && chance(0.5)) set(px, fy + h + 1, pz, "minecraft:soul_lantern");
    }
    set(x, fy + 1, z, "minecraft:crying_obsidian");
    set(x, fy + 2, z, "minecraft:soul_lantern");
  };

  const shrine = (x, z) => {
    disc(x, z, 8, fy, fy, "minecraft:stone_bricks");
    disc(x, z, 5, fy, fy, "minecraft:mossy_stone_bricks");
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
      const h = rint(4, 7);
      fill(x + dx, fy + 1, z + dz, x + dx, fy + h, z + dz, "minecraft:stone_bricks");
      set(x + dx, fy + h + 1, z + dz, pick(["minecraft:stone_brick_slab", "minecraft:soul_lantern"]));
    }
    fill(x - 1, fy + 1, z - 1, x + 1, fy + 1, z + 1, "minecraft:polished_blackstone");
    set(x, fy + 2, z, "minecraft:crying_obsidian");
    set(x, fy + 3, z, "minecraft:soul_lantern");
    debris(x - 6, z - 6, x + 6, z + 6, 8, ["minecraft:stone_bricks", "minecraft:cracked_stone_bricks", "minecraft:cobblestone"]);
  };

  const obelisk = (x, z) => {
    disc(x, z, 7, fy, fy, "minecraft:mossy_stone_bricks");
    disc(x, z, 5, fy, fy, "minecraft:polished_deepslate");
    fill(x - 2, fy + 1, z - 2, x + 2, fy + 3, z + 2, "minecraft:deepslate_bricks");
    fill(x - 1, fy + 4, z - 1, x + 1, fy + 12, z + 1, "minecraft:polished_deepslate");
    fill(x, fy + 13, z, x, fy + 20, z, "minecraft:chiseled_deepslate");
    set(x, fy + 21, z, "minecraft:amethyst_block");
    set(x, fy + 22, z, "minecraft:soul_lantern");
    for (const [ox, oz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) lamp(x + ox, z + oz);
  };

  const hamlet = (x, z) => {
    house(x - 12, z - 9, 8, 7, "S", woodStyle());
    house(x + 4, z - 9, 8, 7, "S", stoneStyle());
    house(x - 4, z + 4, 10, 8, "N", woodStyle());
    well(x, z - 1);
    set(x + 3, fy + 1, z + 1, "minecraft:campfire");
    set(x - 3, fy + 1, z + 2, "minecraft:hay_block");
    set(x + 3, fy + 1, z - 2, "minecraft:barrel");
    lamp(x - 3, z - 3);
    lamp(x + 3, z + 3);
  };

  const outpost = (kind, x, z) => {
    switch (kind) {
      case "ruintower":
        tower(x - 5, z - 5, 11, 18, { floors: [9, 14], door: "S" });
        set(x + 7, fy + 1, z + 7, "minecraft:campfire");
        break;
      case "stones":
        standingStones(x, z);
        break;
      case "camp":
        banditCamp(x, z);
        break;
      case "cabin":
        house(x - 5, z - 4, 10, 8, "S", woodStyle());
        set(x + 7, fy + 1, z + 5, "minecraft:campfire");
        set(x + 8, fy + 1, z + 4, "minecraft:hay_block");
        set(x - 7, fy + 1, z + 5, "minecraft:barrel");
        break;
      case "watch":
        woodTower(x - 2, z - 2, 5, 12);
        for (let a = 0; a < 10; a++) {
          const ang = (a / 10) * Math.PI * 2;
          fill(Math.round(x + Math.cos(ang) * 6), fy + 1, Math.round(z + Math.sin(ang) * 6), Math.round(x + Math.cos(ang) * 6), fy + rint(1, 2), Math.round(z + Math.sin(ang) * 6), "minecraft:oak_fence");
        }
        set(x + 4, fy + 1, z + 4, "minecraft:campfire");
        set(x - 4, fy + 1, z + 4, "minecraft:barrel");
        break;
      case "shrine":
        shrine(x, z);
        break;
      case "hamlet":
        hamlet(x, z);
        break;
      case "obelisk":
        obelisk(x, z);
        break;
    }
  };

  // Animals and villagers. Re-running the arena first removes the old ones
  // (every section starts with these kill commands), so they never pile up.
  const LIFE_TYPES = [
    "minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken", "minecraft:horse",
    "minecraft:rabbit", "minecraft:fox", "minecraft:wolf", "minecraft:villager_v2",
    "minecraft:iron_golem", "minecraft:cat",
  ];
  for (const sec of sections) {
    for (const t of LIFE_TYPES) {
      addOp(sec, `kill @e[type=${t},x=${sec.x0},y=${fy - 10},z=${sec.z0},dx=${S - 1},dy=200,dz=${S - 1}]`, 1);
    }
  }
  const spawnAt = (x, y, z, type) => {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
    const sec = sections[Math.floor((z - Z0) / S) * per + Math.floor((x - X0) / S)];
    addOp(sec, `summon ${type} ${x + 0.5} ${y} ${z + 0.5}`, 1);
  };

  // =====================================================================
  // 1. clear everything, then lay fresh ground
  // =====================================================================
  fill(X0, fy + 1, Z0, X1, fy + 30, Z1, AIR);
  fill(X0, fy - 2, Z0, X1, fy - 1, Z1, "minecraft:dirt");
  fill(X0, fy, Z0, X1, fy, Z1, "minecraft:grass_block");

  // =====================================================================
  // 2. terrain (height map)
  // =====================================================================
  // flat zones: [x, z, flat radius, ramp length] relative to the center
  const PONDS = [[-120, -30, 12], [122, 40, 12], [-40, 115, 11], [45, -115, 11]];
  const FLAT = [
    [0, 0, 60, 22],
    [85, 85, 30, 14], [-85, 85, 30, 14], [85, -85, 30, 14], [-85, -85, 30, 14],
    [0, -110, 18, 10], [110, 0, 18, 10], [0, 110, 18, 10], [-110, 0, 18, 10],
    [85, 0, 18, 8], [-85, 0, 18, 8], [0, 85, 18, 8], [0, -85, 18, 8],
    ...PONDS.map(([x, z, r]) => [x, z, r + 4, 8]),
    ...OUTPOSTS.map(([x, z, k, r]) => [x, z, r, 8]),
    ...CASTLES.map(([x, z]) => [x, z, 28, 6]), // flat ground under the castles
  ];
  // roads: [x1, z1, x2, z2, half width], relative to the center
  const ROADS = [
    [42, 0, 102, 0, 2], [-42, 0, -102, 0, 2], [0, 42, 0, 102, 2], [0, -42, 0, -102, 2],
    [-85, -85, 85, -85, 1], [-85, 85, 85, 85, 1], [-85, -85, -85, 85, 1], [85, -85, 85, 85, 1],
  ];
  const segDist = (px, pz, s) => {
    const dx = s[2] - s[0];
    const dz = s[3] - s[1];
    const l2 = dx * dx + dz * dz;
    const t = clamp(((px - s[0]) * dx + (pz - s[1]) * dz) / l2, 0, 1);
    return Math.hypot(px - (s[0] + t * dx), pz - (s[1] + t * dz));
  };

  const heights = new Int16Array(N * N);
  const kinds = new Uint8Array(N * N); // 0 grass, 1 stone, 2 coarse dirt, 3 gravel
  const masks = new Float32Array(N * N);
  for (let zi = 0; zi < N; zi++) {
    for (let xi = 0; xi < N; xi++) {
      const x = X0 + xi;
      const z = Z0 + zi;
      const rx = x - cx;
      const rz = z - cz;

      let m = 1;
      for (const f of FLAT) {
        const t = clamp((Math.hypot(rx - f[0], rz - f[1]) - f[2]) / f[3], 0, 1);
        if (t < m) m = t;
      }
      for (const r of ROADS) {
        const t = clamp((segDist(rx, rz, r) - (r[4] + 2)) / 7, 0, 1);
        if (t < m) m = t;
      }
      m = smooth(m);

      const n = 0.62 * valueNoise(x / 52, z / 52, seed + 11) + 0.28 * valueNoise(x / 24, z / 24, seed + 23) + 0.1 * valueNoise(x / 11, z / 11, seed + 37);
      const raw = clamp((n - 0.38) / 0.36, 0, 1);
      let h0 = Math.pow(raw, 1.15) * 15;
      const e = ARENA_HALF - 0.5 - Math.max(Math.abs(rx + 0.5), Math.abs(rz + 0.5));
      const edge = clamp((26 - e) / 26, 0, 1);
      h0 += edge * edge * 11 + edge * 3 * n;
      const h = Math.round(h0 * m);

      let k = 0;
      if (h >= 11 || (edge > 0.35 && h >= 4)) k = 1;
      else {
        const p = valueNoise(x / 7, z / 7, seed + 51);
        if (p > 0.94) k = 3;
        else if (p > 0.87) k = 2;
      }
      const i = zi * N + xi;
      heights[i] = h;
      kinds[i] = k;
      masks[i] = m;
    }
  }

  const TOP = ["minecraft:grass_block", "minecraft:stone", "minecraft:coarse_dirt", "minecraft:gravel"];
  for (let zi = 0; zi < N; zi++) {
    const z = Z0 + zi;
    let xi = 0;
    while (xi < N) {
      const h = heights[zi * N + xi];
      const k = kinds[zi * N + xi];
      let xj = xi + 1;
      while (xj < N && heights[zi * N + xj] === h && kinds[zi * N + xj] === k) xj++;
      if (h > 0 || k !== 0) {
        const xa = X0 + xi;
        const xb = X0 + xj - 1;
        if (h >= 2) fill(xa, fy + 1, z, xb, fy + h - 1, z, k === 1 ? "minecraft:stone" : "minecraft:dirt");
        fill(xa, fy + h, z, xb, fy + h, z, TOP[k]);
      }
      xi = xj;
    }
  }

  // ponds
  for (const [px, pz, r] of PONDS) {
    disc(cx + px, cz + pz, r + 2, fy, fy, "minecraft:sand");
    disc(cx + px, cz + pz, r, fy - 1, fy, "minecraft:water");
  }

  // =====================================================================
  // 3. roads + lamp posts
  // =====================================================================
  for (const r of ROADS) {
    const [rx1, rz1, rx2, rz2, hw] = r;
    const ax = cx + Math.min(rx1, rx2);
    const bx = cx + Math.max(rx1, rx2);
    const az = cz + Math.min(rz1, rz2);
    const bz = cz + Math.max(rz1, rz2);
    const alongX = rz1 === rz2;
    if (alongX) fill(ax, fy, az - hw, bx, fy, az + hw, "minecraft:gravel");
    else fill(ax - hw, fy, az, ax + hw, fy, bz, "minecraft:gravel");
    const len = alongX ? bx - ax : bz - az;
    const count = Math.floor(len * (2 * hw + 1) * 0.25);
    for (let n = 0; n < count; n++) {
      const along = rint(0, len);
      const side = rint(-hw, hw);
      const block = pick(["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:coarse_dirt", "minecraft:stone", "minecraft:gravel"]);
      if (alongX) set(ax + along, fy, az + side, block);
      else set(ax + side, fy, az + along, block);
    }
    let i = 0;
    for (let a = 8; a < len; a += 16, i++) {
      const off = i % 2 === 0 ? hw + 1 : -hw - 1;
      if (alongX) lamp(ax + a, az + off);
      else lamp(ax + off, az + a);
    }
  }

  // =====================================================================
  // 4. the castle (center)
  // =====================================================================
  const CW = 40; // half size of the curtain wall
  // courtyard floor
  fill(cx - CW + 3, fy, cz - CW + 3, cx + CW - 4, fy, cz + CW - 4, "minecraft:stone_bricks");
  for (let n = 0; n < 1700; n++) {
    set(rint(cx - CW + 3, cx + CW - 4), fy, rint(cz - CW + 3, cz + CW - 4), pick(["minecraft:cracked_stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:gravel", "minecraft:moss_block", "minecraft:coarse_dirt"]));
  }
  for (let n = 0; n < 350; n++) {
    set(rint(cx - CW + 3, cx + CW - 4), fy + 1, rint(cz - CW + 3, cz + CW - 4), "minecraft:moss_carpet", "keep");
  }
  // battle circle
  disc(cx, cz, 22, fy, fy, "minecraft:polished_blackstone_bricks");
  disc(cx, cz, 19, fy, fy, "minecraft:deepslate_tiles");
  disc(cx, cz, 12, fy, fy, "minecraft:polished_blackstone_bricks");
  disc(cx, cz, 6, fy, fy, "minecraft:chiseled_polished_blackstone");
  for (let n = 0; n < 160; n++) {
    const a = rnd() * Math.PI * 2;
    const rr = rnd() * 22;
    set(Math.round(cx + Math.cos(a) * rr), fy, Math.round(cz + Math.sin(a) * rr), pick(["minecraft:cracked_deepslate_tiles", "minecraft:cracked_polished_blackstone_bricks", "minecraft:gravel"]));
  }

  // curtain wall with four gates
  ruinedWalls(cx - CW, cz - CW, cx + CW - 1, cz + CW - 1, fy, 11, 3, MIX_STONE, 0.4, [
    { side: "N", c: cx, w: 12 }, { side: "S", c: cx, w: 12 },
    { side: "W", c: cz, w: 12 }, { side: "E", c: cz, w: 12 },
  ]);
  // corner towers
  tower(cx - CW, cz - CW, 11, 20, { floors: [9, 15], door: "S" });
  tower(cx + CW - 11, cz - CW, 11, 20, { floors: [9, 15], door: "S" });
  tower(cx - CW, cz + CW - 11, 11, 20, { floors: [9, 15], door: "N" });
  tower(cx + CW - 11, cz + CW - 11, 11, 20, { floors: [9, 15], door: "N" });
  // gatehouse towers beside each gate
  for (const off of [-13, 7]) {
    tower(cx + off, cz - CW, 7, 15, { floors: [8], door: "S" });
    tower(cx + off, cz + CW - 7, 7, 15, { floors: [8], door: "N" });
    tower(cx - CW, cz + off, 7, 15, { floors: [8], door: "E" });
    tower(cx + CW - 7, cz + off, 7, 15, { floors: [8], door: "W" });
  }
  // broken arches over the gates
  for (let a = -6; a <= 6; a += 2) {
    if (chance(0.55)) {
      fill(cx + a, fy + 9, cz - CW, cx + a + 1, fy + 10, cz - CW + 2, "minecraft:stone_bricks");
      fill(cx + a, fy + 9, cz + CW - 3, cx + a + 1, fy + 10, cz + CW - 1, "minecraft:stone_bricks");
      fill(cx - CW, fy + 9, cz + a, cx - CW + 2, fy + 10, cz + a + 1, "minecraft:stone_bricks");
      fill(cx + CW - 3, fy + 9, cz + a, cx + CW - 1, fy + 10, cz + a + 1, "minecraft:stone_bricks");
    }
  }
  for (const [lx, lz] of [[-6, -CW], [5, -CW], [-6, CW - 1], [5, CW - 1], [-CW, -6], [-CW, 5], [CW - 1, -6], [CW - 1, 5]]) {
    set(cx + lx, fy + 11, cz + lz, "minecraft:soul_lantern");
  }

  // keep (inner fortress)
  const KS = 14;
  solidRing(cx - KS, cz - KS, cx + KS, cz + KS, fy + 1, fy + 8, 2, "minecraft:stone_bricks");
  for (const [x, z] of [[cx, cz - KS], [cx, cz + KS - 1], [cx - KS, cz], [cx + KS - 1, cz]]) {
    // doorways
    if (z === cz - KS || z === cz + KS - 1) fill(x - 3, fy + 1, z - 1, x + 3, fy + 6, z + 1, AIR);
    else fill(x - 1, fy + 1, z - 3, x + 1, fy + 6, z + 3, AIR);
  }
  ruinedWalls(cx - KS, cz - KS, cx + KS, cz + KS, fy + 8, 7, 2, MIX_STONE, 0.5, [
    { side: "N", c: cx, w: 7, h: 0 }, { side: "S", c: cx, w: 7, h: 0 },
    { side: "W", c: cz, w: 7, h: 0 }, { side: "E", c: cz, w: 7, h: 0 },
  ]);
  for (let n = 0; n < 90; n++) {
    const side = rint(0, 3);
    const y = fy + rint(1, 8);
    const t = rint(-KS, KS);
    if (side === 0) set(cx + t, y, cz - KS, pick(WEAR));
    else if (side === 1) set(cx + t, y, cz + KS, pick(WEAR));
    else if (side === 2) set(cx - KS, y, cz + t, pick(WEAR));
    else set(cx + KS, y, cz + t, pick(WEAR));
  }
  // keep corner turrets
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    tower(cx + sx * KS - 3, cz + sz * KS - 3, 7, 22, { floors: [10, 16], door: null });
    // doorway on the side facing the great hall (the old door opened into the keep wall)
    const doorX = sx < 0 ? cx - 11 : cx + 11;
    const doorZ = sz < 0 ? cz - 12 : cz + 11;
    fill(doorX, fy + 1, doorZ, doorX, fy + 3, doorZ + 1, AIR);
  }
  // great hall floor, pillars, throne
  fill(cx - KS + 2, fy, cz - KS + 2, cx + KS - 2, fy, cz + KS - 2, "minecraft:deepslate_tiles");
  for (let n = 0; n < 120; n++) {
    set(rint(cx - KS + 2, cx + KS - 2), fy, rint(cz - KS + 2, cz + KS - 2), pick(["minecraft:cracked_deepslate_tiles", "minecraft:gravel", "minecraft:moss_block"]));
  }
  for (const [px, pz] of [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, -9], [0, 9], [-9, 0], [9, 0]]) {
    fill(cx + px, fy + 1, cz + pz, cx + px, fy + rint(5, 11), cz + pz, "minecraft:stone_bricks");
    set(cx + px, fy + 1, cz + pz + 1, "minecraft:soul_lantern");
  }
  fill(cx - 3, fy + 1, cz - 3, cx + 3, fy + 1, cz + 3, "minecraft:polished_blackstone");
  fill(cx - 2, fy + 2, cz - 2, cx + 2, fy + 2, cz + 2, "minecraft:polished_blackstone_bricks");
  fill(cx - 1, fy + 3, cz - 1, cx + 1, fy + 3, cz + 1, "minecraft:blackstone");
  set(cx, fy + 4, cz, "minecraft:crying_obsidian");
  set(cx, fy + 5, cz, "minecraft:soul_lantern");

  // courtyard decoration: broken pillars, lamp posts, rubble, dead trees
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(ang) * 29);
    const pz = Math.round(cz + Math.sin(ang) * 29);
    fill(px - 1, fy + 1, pz - 1, px + 1, fy + 1, pz + 1, "minecraft:mossy_stone_bricks");
    const h = rint(2, 8);
    fill(px, fy + 2, pz, px, fy + h, pz, "minecraft:stone_bricks");
    if (chance(0.5)) set(px, fy + h + 1, pz, "minecraft:stone_brick_slab");
    else if (chance(0.5)) set(px, fy + h + 1, pz, "minecraft:soul_lantern");
  }
  for (let n = 0; n < 70; n++) {
    const x = rint(cx - CW + 4, cx + CW - 5);
    const z = rint(cz - CW + 4, cz + CW - 5);
    if (Math.abs(x - cx) < 16 && Math.abs(z - cz) < 16) continue;
    set(x, fy + 1, z, pick(["minecraft:cobblestone", "minecraft:mossy_cobblestone", "minecraft:andesite", "minecraft:cracked_stone_bricks", "minecraft:gravel"]), "keep");
    if (chance(0.5)) set(x + 1, fy + 1, z, "minecraft:mossy_cobblestone", "keep");
    if (chance(0.3)) set(x, fy + 2, z, "minecraft:cobblestone", "keep");
  }
  for (const [tx, tz] of [[-33, -20], [33, 20], [-25, 33], [26, -33]]) forestTree(cx + tx, cz + tz, fy, "dead");

  // =====================================================================
  // 5. role camps + waystations
  // =====================================================================
  const camps = [
    [0, -110, "minecraft:diamond_block"], // north: Slayer
    [110, 0, "minecraft:netherite_block"], // east: Hunter
    [0, 110, "minecraft:iron_block"], // south: Tanker
    [-110, 0, "minecraft:gold_block"], // west: Marksman
  ];
  for (const [dx, dz, block] of camps) {
    const px = cx + dx;
    const pz = cz + dz;
    disc(px, pz, 8, fy, fy, "minecraft:polished_blackstone_bricks");
    disc(px, pz, 6, fy, fy, block);
    disc(px, pz, 4, fy, fy, "minecraft:polished_blackstone");
    disc(px, pz, 2, fy, fy, "minecraft:chiseled_polished_blackstone");
    fill(px, fy + 1, pz, px, fy + 5, pz, block);
    set(px, fy + 6, pz, "minecraft:soul_lantern");
    for (const [ox, oz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) lamp(px + ox, pz + oz);
    const tx = dx === 0 ? px + 12 : px - 3;
    const tz = dz === 0 ? pz + 12 : pz - 3;
    tower(tx - 3, tz - 3, 7, 14, { floors: [8], door: dz === 0 ? "N" : "W" });
    set(px - 4, fy + 1, pz + 4, "minecraft:campfire");
    set(px + 4, fy + 1, pz - 4, "minecraft:campfire");
    set(px - 5, fy + 1, pz + 5, "minecraft:hay_block");
    set(px + 5, fy + 1, pz - 5, "minecraft:barrel");
  }
  for (const [dx, dz] of [[85, 0], [-85, 0], [0, 85], [0, -85]]) {
    const px = cx + dx;
    const pz = cz + dz;
    tower(px + 6, pz + 6, 7, 12, { floors: [7], door: "W" });
    set(px + 4, fy + 1, pz - 4, "minecraft:campfire");
    set(px + 5, fy + 1, pz - 5, "minecraft:barrel");
    set(px - 4, fy + 1, pz + 5, "minecraft:hay_block");
  }

  // =====================================================================
  // 6. villages (four corners)
  // =====================================================================
  const placeBuilding = (kind, bx, bz, vz) => {
    const door = bz < vz ? "S" : "N";
    switch (kind) {
      case "wood": {
        const w = rint(8, 10);
        const d = rint(7, 9);
        return house(bx - Math.floor(w / 2), bz - Math.floor(d / 2), w, d, door, woodStyle());
      }
      case "stone": {
        const w = rint(8, 10);
        const d = rint(8, 10);
        return house(bx - Math.floor(w / 2), bz - Math.floor(d / 2), w, d, door, stoneStyle());
      }
      case "barn":
        return house(bx - 6, bz - 4, 13, 9, door, barnStyle());
      case "chapel":
        return chapel(bx - 4, bz - 6, 9, 13, door);
      case "smith":
        return smith(bx - 4, bz - 3, 9, 7, door);
      case "farm":
        return farm(bx - 5, bz - 5, 11, 11);
      case "graveyard":
        return graveyard(bx - 6, bz - 5, 13, 11, door);
      case "tower":
        return woodTower(bx - 2, bz - 2, 5, 12);
      default:
        return null;
    }
  };

  const villages = [
    [85, -85, ["wood", "stone", "chapel", "wood"]],
    [-85, -85, ["smith", "wood", "stone", "wood"]],
    [-85, 85, ["barn", "wood", "farm", "wood"]],
    [85, 85, ["stone", "wood", "graveyard", "tower"]],
  ];
  for (const [vdx, vdz, kinds4] of villages) {
    const vx = cx + vdx;
    const vz = cz + vdz;
    well(vx, vz);
    const slots = [[-15, -15], [15, -15], [-15, 15], [15, 15]];
    slots.forEach(([sx, sz], i) => placeBuilding(kinds4[i], vx + sx, vz + sz, vz));
    for (const [sx, sz] of [[-7, -7], [6, -7], [-7, 6], [6, 6]]) {
      if (chance(0.7)) stall(vx + sx - 1, vz + sz - 1);
    }
    for (const [lx, lz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) lamp(vx + lx, vz + lz);
    set(vx + 3, fy + 1, vz - 2, "minecraft:campfire");
    set(vx - 3, fy + 1, vz + 2, "minecraft:hay_block");
    set(vx + 2, fy + 1, vz + 3, "minecraft:barrel");
  }

  // =====================================================================
  // 6b. FOUR BIG PVP CASTLES (one in each corner) with loot on every floor
  //     keep = floor + 82 (the dragon's flying height), corner towers = floor + 74
  //     Uses its own random generator, so the rest of the arena keeps its layout.
  //     Potions use the old Bedrock data numbers (21 = healing, 14 = swiftness, ...).
  // =====================================================================
  {
    const crnd = makeRng(seed + 4242);
    const cpick = (a) => a[Math.floor(crnd() * a.length)];
    const crint = (a, b) => a + Math.floor(crnd() * (b - a + 1));
    const cchance = (p) => crnd() < p;

    const rawOp = (x, z, cmd) => {
      if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
      addOp(sections[Math.floor((z - Z0) / S) * per + Math.floor((x - X0) / S)], cmd, 1);
    };

    // ---------- loot tables: [item, amount, (potion data)] ----------
    const FOOD = [["cooked_beef", 16], ["cooked_porkchop", 16], ["bread", 16], ["golden_carrot", 12], ["cooked_chicken", 16], ["baked_potato", 16], ["cooked_mutton", 16], ["golden_apple", 2]];
    const FOOD_RARE = [["golden_apple", 4], ["enchanted_golden_apple", 1]];
    const WEAPONS = [
      [["stone_sword", 1], ["iron_axe", 1], ["bow", 1], ["crossbow", 1], ["iron_sword", 1]],
      [["iron_sword", 1], ["iron_axe", 1], ["bow", 1], ["crossbow", 1], ["diamond_sword", 1]],
      [["diamond_sword", 1], ["diamond_axe", 1], ["trident", 1], ["bow", 1], ["crossbow", 1], ["netherite_sword", 1]],
    ];
    const ARMOR_MAT = ["chainmail", "iron", "diamond"];
    const ARMOR_PIECES = ["helmet", "chestplate", "leggings", "boots"];
    const POTIONS = [
      ["potion", 1, 21], // healing
      ["potion", 1, 22], // healing II
      ["potion", 1, 14], // swiftness
      ["potion", 1, 16], // swiftness II
      ["potion", 1, 31], // strength
      ["potion", 1, 28], // regeneration
      ["potion", 1, 12], // fire resistance
      ["potion", 1, 9], // leaping
      ["splash_potion", 1, 21], // splash healing
      ["splash_potion", 1, 23], // splash harming
      ["splash_potion", 1, 24], // splash harming II
      ["splash_potion", 1, 22], // splash healing II
    ];
    const UTIL = [["ender_pearl", 4], ["ender_pearl", 8], ["shield", 1], ["web", 8], ["water_bucket", 1], ["experience_bottle", 16], ["golden_apple", 3], ["fire_charge", 8], ["flint_and_steel", 1], ["snowball", 16]];
    const BLOCKS = [["cobblestone", 64], ["oak_planks", 64], ["stone_bricks", 64], ["oak_log", 32]];

    // One chest + its items. tier 1 = basic, 2 = good, 3 = best
    const lootChest = (x, y, z, tier) => {
      set(x, y, z, "minecraft:chest");
      const items = [cpick(FOOD), cpick(FOOD), cpick(WEAPONS[tier - 1]), cpick([["arrow", 32], ["arrow", 64]]), cpick(BLOCKS), cpick(UTIL)];
      if (cchance(0.25 * tier)) items.push(cpick(FOOD_RARE));
      if (tier === 3 && cchance(0.35)) items.push(["totem_of_undying", 1]);
      const pieces = ARMOR_PIECES.slice().sort(() => crnd() - 0.5);
      for (let a = 0; a < tier; a++) items.push([`${ARMOR_MAT[tier - 1]}_${pieces[a]}`, 1]);
      for (let p = 0; p < 2 + tier; p++) items.push(cpick(POTIONS));

      const slots = Array.from({ length: 27 }, (_, i) => i);
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(crnd() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      items.forEach((it, k) => {
        rawOp(x, z, `replaceitem block ${x} ${y} ${z} slot.container ${slots[k]} ${it[0]} ${it[1]}${it[2] !== undefined ? " " + it[2] : ""}`);
      });
    };

    // Builds one castle in canonical local coordinates (local +x / +z point toward the arena
    // center, so the two gates always face the middle). lx/lz are mirrored into the real world.
    const bigCastle = (ccx, ccz, team) => {
      const mx = ccx < cx ? 1 : -1;
      const mz = ccz < cz ? 1 : -1;
      const AX = (l) => ccx + mx * l;
      const AZ = (l) => ccz + mz * l;
      const lset = (lx, y, lz, block, mode = "") => set(AX(lx), y, AZ(lz), block, mode);
      const lfill = (x1, y1, z1, x2, y2, z2, block, mode = "") => fill(AX(x1), y1, AZ(z1), AX(x2), y2, AZ(z2), block, mode);
      // ladder facing (local direction the ladder faces, away from its wall) -> world facing_direction
      const facing = (dx, dz) => {
        const ax = mx * dx;
        const az = mz * dz;
        return az < 0 ? 2 : az > 0 ? 3 : ax < 0 ? 4 : 5;
      };
      const ladder = (lx, lz, y1, y2, dx, dz) => lfill(lx, y1, lz, lx, y2, lz, `minecraft:ladder ["facing_direction"=${facing(dx, dz)}]`);
      const chestAt = (lx, y, lz, tier) => lootChest(AX(lx), y, AZ(lz), tier);
      const lring = (ax, bx, az, bz, y1, y2, th, block) => {
        for (let t = 0; t < th; t++) {
          const x1 = ax + t;
          const x2 = bx - t;
          const z1 = az + t;
          const z2 = bz - t;
          if (x1 > x2 || z1 > z2) break;
          lfill(x1, y1, z1, x2, y2, z1, block);
          if (z2 > z1) lfill(x1, y1, z2, x2, y2, z2, block);
          if (z2 - z1 > 1) {
            lfill(x1, y1, z1 + 1, x1, y2, z2 - 1, block);
            if (x2 > x1) lfill(x2, y1, z1 + 1, x2, y2, z2 - 1, block);
          }
        }
      };
      // checkerboard gaps along the top of a ring = battlements
      const crenels = (ax, bx, az, bz, y, th) => {
        for (let t = 0; t < th; t++) {
          const x1 = ax + t;
          const x2 = bx - t;
          const z1 = az + t;
          const z2 = bz - t;
          for (let x = x1; x <= x2; x++) {
            for (let z = z1; z <= z2; z++) {
              if (x !== x1 && x !== x2 && z !== z1 && z !== z2) continue;
              if ((((x + z) % 2) + 2) % 2 === 0) lset(x, y, z, AIR);
            }
          }
        }
      };

      const STONE = "minecraft:stone_bricks";
      const DARK = "minecraft:polished_blackstone_bricks";
      const WORN = ["minecraft:cracked_stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:andesite"];
      const wool = `minecraft:${team}_wool`;
      const carpet = `minecraft:${team}_carpet`;
      // banner pole: fence + 3x3 flag that hangs toward local direction dir (+1 / -1 on x)
      const pole = (lx, y, lz, h, dir) => {
        lfill(lx, y, lz, lx, y + h, lz, "minecraft:oak_fence");
        lfill(lx + dir, y + h - 3, lz, lx + dir * 3, y + h - 1, lz, wool);
        lset(lx, y + h + 1, lz, "minecraft:lantern");
      };
      const lampPost = (lx, lz) => {
        lfill(lx, fy + 1, lz, lx, fy + 3, lz, "minecraft:cobblestone_wall");
        lset(lx, fy + 4, lz, "minecraft:lantern");
      };

      // ---------- ground, courtyard paths ----------
      lfill(-21, fy + 31, -21, 21, fy + 96, 21, AIR); // wipe anything left from an older build
      lfill(-20, fy, -20, 20, fy, 20, STONE);
      for (let n = 0; n < 260; n++) {
        lset(crint(-20, 20), fy, crint(-20, 20), cpick(["minecraft:cracked_stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:polished_andesite", "minecraft:gravel"]));
      }
      lfill(8, fy, -2, 16, fy, 2, "minecraft:polished_andesite"); // keep door -> east gate
      lfill(-2, fy, 8, 2, fy, 16, "minecraft:polished_andesite"); // keep door -> south gate

      // ---------- curtain wall (33 x 33, 3 thick, 12 high) with two gates ----------
      lring(-16, 16, -16, 16, fy + 1, fy + 12, 3, STONE);
      for (let n = 0; n < 200; n++) {
        const side = crint(0, 3);
        const t = crint(-16, 16);
        const y = fy + crint(1, 12);
        const b = cpick(WORN);
        if (side === 0) lset(t, y, -16, b);
        else if (side === 1) lset(t, y, 16, b);
        else if (side === 2) lset(-16, y, t, b);
        else lset(16, y, t, b);
      }
      for (const k of [-8, 8]) {
        lfill(k, fy + 1, -17, k, fy + 13, -17, DARK);
        lfill(k, fy + 1, 17, k, fy + 13, 17, DARK);
        lfill(-17, fy + 1, k, -17, fy + 13, k, DARK);
        lfill(17, fy + 1, k, 17, fy + 13, k, DARK);
      }
      for (let k = -16; k <= 16; k += 2) {
        // merlons on the outer edge of the wall walk
        lfill(k, fy + 13, -16, k, fy + 14, -16, STONE);
        lfill(k, fy + 13, 16, k, fy + 14, 16, STONE);
        lfill(-16, fy + 13, k, -16, fy + 14, k, STONE);
        lfill(16, fy + 13, k, 16, fy + 14, k, STONE);
      }
      lfill(14, fy + 1, -3, 16, fy + 7, 3, AIR); // east gate
      lfill(-3, fy + 1, 14, 3, fy + 7, 16, AIR); // south gate
      lfill(14, fy + 7, -3, 14, fy + 7, 3, "minecraft:iron_bars"); // portcullis teeth
      lfill(-3, fy + 7, 14, 3, fy + 7, 14, "minecraft:iron_bars");
      // ladders up to the wall walk (on the two walls without a gate)
      ladder(-13, 0, fy + 1, fy + 12, 1, 0);
      ladder(0, -13, fy + 1, fy + 12, 0, 1);

      // ---------- 4 corner towers: 9 x 9, 74 high, floors every 10, loot on each ----------
      const tower = (sx, sz) => {
        const x0 = sx > 0 ? 11 : -19;
        const z0 = sz > 0 ? 11 : -19;
        const x1 = x0 + 8;
        const z1 = z0 + 8;
        const TH = 74;
        const TF = [12, 22, 32, 42, 52, 62, 72];
        const levels = [0, ...TF];
        const tiers = [1, 1, 1, 2, 2, 3, 3, 3];

        lfill(x0, fy + 1, z0, x1, fy + TH + 6, z1, AIR);
        lring(x0, x1, z0, z1, fy + 1, fy + TH, 2, STONE);
        for (const F of TF) {
          lfill(x0 + 2, fy + F, z0 + 2, x1 - 2, fy + F, z1 - 2, "minecraft:spruce_planks");
          lring(x0, x1, z0, z1, fy + F, fy + F, 1, DARK);
        }

        // ladder from the ground floor to the roof, against the outer wall
        const lx = sx > 0 ? x1 - 2 : x0 + 2;
        ladder(lx, z0 + 4, fy + 1, fy + 72, -sx, 0);

        // arrow slits in the outer walls (never next to the ladder)
        const oxa = sx > 0 ? x1 - 1 : x0;
        const oza = sz > 0 ? z1 - 1 : z0;
        for (const F of levels) {
          const y1 = F === 0 ? fy + 3 : fy + F + 2;
          const y2 = y1 + 1;
          for (const lz of [z0 + 2, z0 + 6]) lfill(oxa, y1, lz, oxa + 1, y2, lz, AIR);
          for (const lxx of [x0 + 2, x0 + 4, x0 + 6]) lfill(lxx, y1, oza, lxx, y2, oza + 1, AIR);
        }

        // openings to the wall walk (floor 12 is level with the top of the wall)
        const zlo = sz > 0 ? 14 : -16;
        const zhi = sz > 0 ? 16 : -14;
        const xlo = sx > 0 ? 14 : -16;
        const xhi = sx > 0 ? 16 : -14;
        const ixa = sx > 0 ? x0 : x1 - 1;
        const iza = sz > 0 ? z0 : z1 - 1;
        lfill(ixa, fy + 13, zlo, ixa + 1, fy + 15, zhi, AIR);
        lfill(xlo, fy + 13, iza, xhi, fy + 15, iza + 1, AIR);
        // ground door into the courtyard
        lfill(sx * 13, fy + 1, iza, sx * 13, fy + 3, iza + 1, AIR);

        crenels(x0, x1, z0, z1, fy + TH, 2);
        pole(x0 + 4, fy + 73, z0 + 4, 8, 1);

        // loot: two chests on every level, best loot on top
        const cxs = sx > 0 ? x1 - 2 : x0 + 2;
        levels.forEach((F, i) => {
          chestAt(cxs, fy + F + 1, z0 + 2, tiers[i]);
          chestAt(cxs, fy + F + 1, z1 - 2, tiers[i]);
          lset(sx > 0 ? x0 + 2 : x1 - 2, fy + F + 1, sz > 0 ? z1 - 2 : z0 + 2, "minecraft:lantern");
        });
      };
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower(sx, sz);

      // ---------- the great keep: 17 x 17, 82 high (the dragon's height), 8 floors ----------
      const KH = 82;
      const KF = [10, 20, 30, 40, 50, 60, 70, 80];
      const KLEVELS = [0, 10, 20, 30, 40, 50, 60, 70];
      const KTIER = [1, 1, 1, 2, 2, 2, 3, 3];
      lring(-8, 8, -8, 8, fy + 1, fy + KH, 3, STONE);
      for (let n = 0; n < 300; n++) {
        const side = crint(0, 3);
        const t = crint(-8, 8);
        const y = fy + crint(1, KH);
        const b = cpick(WORN);
        if (side === 0) lset(t, y, -8, b);
        else if (side === 1) lset(t, y, 8, b);
        else if (side === 2) lset(-8, y, t, b);
        else lset(8, y, t, b);
      }
      for (const F of KF) {
        lfill(-5, fy + F, -5, 5, fy + F, 5, "minecraft:spruce_planks");
        lring(-8, 8, -8, 8, fy + F, fy + F, 1, DARK);
      }
      // two ladders from the ground to the roof, leaning on the north and south walls
      ladder(-4, -5, fy + 1, fy + 80, 0, 1);
      ladder(4, 5, fy + 1, fy + 80, 0, -1);
      // doors at the bottom (facing the gates)
      lfill(6, fy + 1, -2, 8, fy + 5, 2, AIR);
      lfill(-2, fy + 1, 6, 2, fy + 5, 8, AIR);

      // windows on every floor (not on the ladder cells' walls)
      for (const F of KLEVELS) {
        const y1 = F === 0 ? fy + 3 : fy + F + 2;
        const y2 = y1 + 2;
        for (const lat of [0, 4]) lfill(lat, y1, -8, lat, y2, -6, AIR); // north
        for (const lat of F === 0 ? [-4] : [-4, 0]) lfill(lat, y1, 6, lat, y2, 8, AIR); // south
        for (const lat of [-4, 0, 4]) lfill(-8, y1, lat, -6, y2, lat, AIR); // west
        for (const lat of F === 0 ? [-4, 4] : [-4, 0, 4]) lfill(6, y1, lat, 8, y2, lat, AIR); // east
      }

      // rooms: carpet, lanterns, workstations, 4 chests per floor
      const STATION = { 10: "minecraft:crafting_table", 20: "minecraft:furnace", 30: "minecraft:anvil", 40: "minecraft:enchanting_table", 50: "minecraft:brewing_stand", 60: "minecraft:smithing_table" };
      KLEVELS.forEach((F, i) => {
        const y = fy + F + 1;
        lfill(-3, y, -3, 3, y, 3, carpet);
        if (STATION[F]) lset(0, y, 0, STATION[F]);
        for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) lset(a, y, b, "minecraft:lantern");
        for (const [a, b] of [[-5, -2], [-5, 2], [2, -5], [5, -4]]) chestAt(a, y, b, KTIER[i]);
      });

      // roof: battlements, corner spires, treasure chests and the banner
      crenels(-8, 8, -8, 8, fy + KH, 3);
      for (const [sx2, sz2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        lfill(sx2 * 6, fy + KH + 1, sz2 * 6, sx2 * 8, fy + KH + 6, sz2 * 8, STONE);
        lset(sx2 * 7, fy + KH + 7, sz2 * 7, "minecraft:lantern");
      }
      chestAt(-3, fy + 81, 3, 3);
      chestAt(3, fy + 81, -3, 3);
      pole(0, fy + 81, 0, 11, 1);

      // ---------- courtyard: loot chests, banners and lamp posts ----------
      for (const [a, b] of [[-12, -4], [-12, 4], [-4, -12], [4, -12], [12, -5], [12, 5]]) chestAt(a, fy + 1, b, 1);
      for (const [a, b] of [[12, -8], [12, 8], [-8, 12], [8, 12]]) pole(a, fy + 1, b, 9, -1);
      for (const [a, b] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) lampPost(a, b);
    };

    for (const [dx, dz, team] of CASTLES) bigCastle(cx + dx, cz + dz, team);
  }

  // =====================================================================
  // 7. outposts, banners, small ruins, DENSE forests, plants, wildlife
  // =====================================================================
  for (const [ox, oz, kind] of OUTPOSTS) outpost(kind, cx + ox, cz + oz);

  // banners in front of the four castle gates
  [[-10, -CW - 4], [10, -CW - 4], [-10, CW + 3], [10, CW + 3], [-CW - 4, -10], [-CW - 4, 10], [CW + 3, -10], [CW + 3, 10]].forEach(([fx, fz], i) => {
    flag(cx + fx, cz + fz, 9, i % 2 ? "minecraft:black_wool" : "minecraft:red_wool");
  });

  // small ruins on flat open ground (never in the forest corners)
  let ruins = 0;
  for (let n = 0; n < 1500 && ruins < 130; n++) {
    const xi = rint(8, N - 9);
    const zi = rint(8, N - 9);
    const i = zi * N + xi;
    if (masks[i] < 0.999 || treeCells[i]) continue;
    const rx = X0 + xi - cx;
    const rz = Z0 + zi - cz;
    if (Math.abs(rx) > 48 && Math.abs(rz) > 48) continue;
    const h0 = heights[i];
    if ([[4, 0], [0, 3], [4, 3], [-3, 0], [2, 0]].some(([a, b]) => heights[(zi + b) * N + xi + a] !== h0)) continue;
    smallRuin(X0 + xi, Z0 + zi, fy + h0);
    ruins++;
  }

  // DENSE FOREST on all open ground: the 4 corners (packed), the 4 sides and the middle areas.
  let forestTrees = 0;
  for (let a = -146; a <= 146; a += 2) {
    for (let b = -146; b <= 146; b += 2) {
      const x = cx + a + rint(-1, 1);
      const z = cz + b + rint(-1, 1);
      const xi = x - X0;
      const zi = z - Z0;
      if (xi < 2 || xi > N - 4 || zi < 2 || zi > N - 4) continue;
      const i = zi * N + xi;
      if (masks[i] < 0.999 || treeCells[i]) continue;
      if (valueNoise(x / 16, z / 16, seed + 91) > 0.9) continue; // a few small clearings
      const aa = Math.abs(a);
      const bb = Math.abs(b);
      let p;
      if (aa > 44 && bb > 44) p = clamp(1.1 - Math.hypot(aa - 125, bb - 125) / 140, 0.75, 0.98); // corners
      else if (aa > 44 || bb > 44) p = 0.85; // sides
      else p = 0.7; // middle areas
      if (!chance(p)) continue;
      forestTree(x, z, fy + heights[i]);
      forestTrees++;
    }
  }

  // lighter woods everywhere else
  let trees = 0;
  for (let n = 0; n < 4200; n++) {
    const xi = rint(2, N - 4);
    const zi = rint(2, N - 4);
    const i = zi * N + xi;
    if (masks[i] < 0.999 || treeCells[i]) continue;
    const x = X0 + xi;
    const z = Z0 + zi;
    const dens = clamp((valueNoise(x / 30, z / 30, seed + 71) - 0.4) / 0.35, 0, 1) * 0.6 + 0.05;
    if (!chance(dens)) continue;
    forestTree(x, z, fy + heights[i]);
    trees++;
  }

  let boulders = 0;
  for (let n = 0; n < 700; n++) {
    const xi = rint(2, N - 4);
    const zi = rint(2, N - 4);
    const i = zi * N + xi;
    if (masks[i] < 0.999 || treeCells[i] || !chance(0.16)) continue;
    boulder(X0 + xi, Z0 + zi, fy + heights[i]);
    boulders++;
  }

  // grass, ferns, flowers, berry bushes and leaf bushes on every grass patch
  const GRASS = ["minecraft:short_grass", "minecraft:short_grass", "minecraft:short_grass", "minecraft:fern"];
  const FLOWERS = ["minecraft:poppy", "minecraft:dandelion", "minecraft:cornflower", "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:red_tulip", "minecraft:allium", "minecraft:lily_of_the_valley"];
  for (let n = 0; n < 14000; n++) {
    const xi = rint(2, N - 3);
    const zi = rint(2, N - 3);
    const i = zi * N + xi;
    if (masks[i] < 0.999 || kinds[i] !== 0 || treeCells[i]) continue;
    const x = X0 + xi;
    const z = Z0 + zi;
    const gy = fy + heights[i];
    const r = rnd();
    if (r < 0.55) set(x, gy + 1, z, pick(GRASS), "keep");
    else if (r < 0.75) set(x, gy + 1, z, pick(FLOWERS), "keep");
    else if (r < 0.8) set(x, gy + 1, z, 'minecraft:sweet_berry_bush ["growth"=3]', "keep");
    else if (r < 0.86) {
      crossAt(x, gy + 1, z, 1, "oak");
      set(x, gy + 2, z, LEAF("oak"), "keep");
    }
  }

  // wildlife: herds on open ground, wolves / foxes / rabbits in the forest corners
  const FARM = ["minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken", "minecraft:horse", "minecraft:sheep"];
  const WILD = ["minecraft:wolf", "minecraft:fox", "minecraft:rabbit", "minecraft:rabbit"];
  let herds = 0;
  for (let n = 0; n < 2500 && herds < 100; n++) {
    const xi = rint(8, N - 9);
    const zi = rint(8, N - 9);
    const i = zi * N + xi;
    if (masks[i] < 0.999 || kinds[i] !== 0 || treeCells[i]) continue;
    const rx = X0 + xi - cx;
    const rz = Z0 + zi - cz;
    const inCorner = Math.abs(rx) > 48 && Math.abs(rz) > 48;
    const type = inCorner ? pick(WILD) : pick(FARM);
    const size = type === "minecraft:wolf" ? rint(2, 3) : rint(2, 4);
    for (let q = 0; q < size; q++) {
      const x = X0 + xi + rint(-2, 2);
      const z = Z0 + zi + rint(-2, 2);
      const j = (z - Z0) * N + (x - X0);
      if (treeCells[j]) continue;
      spawnAt(x, fy + heights[j] + 1, z, type);
    }
    herds++;
  }
  // villagers, golems and cats in the four villages
  for (const [vdx, vdz] of [[85, -85], [-85, -85], [-85, 85], [85, 85]]) {
    const vx = cx + vdx;
    const vz = cz + vdz;
    for (const [ox, oz] of [[3, -4], [-4, -3], [4, 4], [-3, 4]]) spawnAt(vx + ox, fy + 1, vz + oz, "minecraft:villager_v2");
    spawnAt(vx + 4, fy + 1, vz - 4, "minecraft:iron_golem");
    spawnAt(vx - 4, fy + 1, vz + 3, "minecraft:cat");
  }
  // golems guard the castle courtyard, horses wait at the four role camps
  for (const [ox, oz] of [[-20, 0], [20, 0], [0, -20], [0, 20]]) spawnAt(cx + ox, fy + 1, cz + oz, "minecraft:iron_golem");
  for (const [dx, dz] of [[0, -110], [110, 0], [0, 110], [-110, 0]]) spawnAt(cx + dx + 2, fy + 1, cz + dz + 6, "minecraft:horse");

  // =====================================================================
  // 8. THE DRAGON: a huge block dragon in a lively, NON-symmetrical flying pose
  //    Head points east, flies at about floor + 82.
  // =====================================================================
  {
    const DX = cx;
    const DY = fy + 82;
    const DZ = cz;
    // wipe the old dragon first, so re-running the arena never stacks dragons
    fill(DX - 80, DY - 48, DZ - 100, DX + 146, DY + 60, DZ + 100, AIR);

    const vox = new Map();
    const put = (x, y, z, b) => vox.set(`${DX + Math.round(x)},${DY + Math.round(y)},${DZ + Math.round(z)}`, b);

    const SCALE = ["minecraft:blackstone", "minecraft:blackstone", "minecraft:polished_blackstone", "minecraft:deepslate_bricks", "minecraft:polished_blackstone_bricks", "minecraft:cracked_polished_blackstone_bricks"];
    const BELLY = ["minecraft:red_nether_bricks", "minecraft:red_nether_bricks", "minecraft:nether_bricks", "minecraft:cracked_nether_bricks"];
    const BONE = "minecraft:bone_block";
    const CORE = "minecraft:blackstone";
    const scale = () => (chance(0.06) ? "minecraft:magma" : pick(SCALE));
    const belly = () => pick(BELLY);

    // ---- helpers ----
    const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const lineThick = (a, b, t, block) => {
      const n = Math.ceil(dist3(a, b) * 1.5) + 1;
      for (let q = 0; q <= n; q++) {
        const f = q / n;
        const px = a[0] + (b[0] - a[0]) * f;
        const py = a[1] + (b[1] - a[1]) * f;
        const pz = a[2] + (b[2] - a[2]) * f;
        for (let ox = 0; ox < t; ox++) for (let oy = 0; oy < t; oy++) for (let oz = 0; oz < t; oz++) put(px + ox, py + oy, pz + oz, block);
      }
    };
    const limb = (pts, th, block) => {
      for (let k = 0; k < pts.length - 1; k++) lineThick(pts[k], pts[k + 1], th[Math.min(k, th.length - 1)], block);
    };
    const tri = (A, B, C, block) => {
      const n = Math.ceil(Math.max(dist3(A, B), dist3(B, C), dist3(A, C)) * 1.6);
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          put(A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v, block);
        }
      }
    };
    const ellipsoid = (ex, ey, ez, rx, ry, rz, shellFn, coreBlock) => {
      const inside = (x, y, z) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 + ((z - ez) / rz) ** 2 <= 1;
      for (let x = Math.floor(ex - rx); x <= Math.ceil(ex + rx); x++) {
        for (let y = Math.floor(ey - ry); y <= Math.ceil(ey + ry); y++) {
          for (let z = Math.floor(ez - rz); z <= Math.ceil(ez + rz); z++) {
            if (!inside(x, y, z)) continue;
            const edge = !inside(x + 1, y, z) || !inside(x - 1, y, z) || !inside(x, y + 1, z) || !inside(x, y - 1, z) || !inside(x, y, z + 1) || !inside(x, y, z - 1);
            put(x, y, z, edge ? shellFn() : coreBlock);
          }
        }
      }
    };
    // round slice of the body at one x position
    const slice = (x, cy, cz2, r, shellFn, coreFn) => {
      const W = (dy) => {
        const v = r * r - dy * dy;
        return v < 0 ? -1 : Math.floor(Math.sqrt(v) + 0.5);
      };
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) {
        const w = W(dy);
        if (w < 0) continue;
        const inner = Math.min(W(dy - 1), W(dy + 1));
        for (let dz = -w; dz <= w; dz++) {
          put(x, cy + dy, cz2 + dz, Math.abs(dz) > inner ? shellFn(dy, r) : coreFn());
        }
      }
    };
    // a clawed foot: 3 toes fanning out, each with a hooked bone claw, plus a back claw
    const paw = (p, d, len) => {
      const h = Math.hypot(d[0], d[2]) || 1;
      const sx = -d[2] / h;
      const sz = d[0] / h;
      for (const c of [-1, 0, 1]) {
        const mid = [p[0] + d[0] * len * 0.5 + sx * c * 1.6, p[1] + d[1] * len * 0.5, p[2] + d[2] * len * 0.5 + sz * c * 1.6];
        const tip = [p[0] + d[0] * len + sx * c * 2.8, p[1] + d[1] * len - 1, p[2] + d[2] * len + sz * c * 2.8];
        lineThick(p, mid, 2, "minecraft:blackstone");
        lineThick(mid, tip, 1, "minecraft:polished_blackstone");
        lineThick(tip, [tip[0] + d[0] * 2, tip[1] - 2.5, tip[2] + d[2] * 2], 1, BONE);
      }
      lineThick(p, [p[0] - d[0] * 3, p[1] - 1.5, p[2] - d[2] * 3], 1, BONE);
    };

    // ---- wings first (so the body is drawn over their roots). NOT mirrored on purpose ----
    const MEM = "minecraft:red_stained_glass";
    const WINGS = [
      // raised wing (upstroke): high wrist, tips curling up
      { s: 1, S0: [8, 9, 7], Wr: [2, 40, 24], T: [[30, 52, 50], [8, 47, 62], [-14, 36, 54], [-30, 22, 40]], Rt: [-22, 3, 8] },
      // lowered wing (downstroke): long, wide and low
      { s: -1, S0: [8, 7, -7], Wr: [4, 26, -34], T: [[30, 14, -76], [8, 5, -88], [-16, -3, -72], [-34, -6, -48]], Rt: [-22, -1, -8] },
    ];
    for (const W of WINGS) {
      const s = W.s;
      const rim = [...W.T, W.Rt];
      const pull = (a, b) => [0, 1, 2].map((k) => W.Wr[k] + ((a[k] + b[k]) / 2 - W.Wr[k]) * 0.8);
      for (let k = 0; k < rim.length - 1; k++) {
        const m = pull(rim[k], rim[k + 1]);
        tri(W.Wr, rim[k], m, MEM);
        tri(W.Wr, m, rim[k + 1], MEM);
      }
      tri(W.Wr, W.Rt, W.S0, MEM);
      lineThick(W.S0, W.Wr, 3, "minecraft:blackstone"); // arm
      for (const t of W.T) {
        lineThick(W.Wr, t, 2, "minecraft:polished_blackstone"); // fingers
        lineThick(t, [t[0] + 3, t[1] - 4, t[2] + s * 2], 1, BONE); // claw tips
      }
      lineThick(W.Wr, [W.Wr[0] + 10, W.Wr[1] + 9, W.Wr[2] + s * 2], 2, BONE); // thumb claw
    }

    // ---- body, S-curved tail and neck ----
    const smoothS = (t) => t * t * (3 - 2 * t);
    const spine = (x) => {
      if (x < -20) {
        const u = (-20 - x) / 44; // 0 at the body ... 1 at the tail tip
        return {
          y: -9 * Math.sin(u * Math.PI * 0.8) + 8 * Math.pow(u, 4) + 2 * Math.sin(u * 9) * u,
          z: 18 * Math.sin(u * Math.PI * 1.5) * u + 3 * Math.sin(u * 11) * u, // whipping S shape
          r: 1.2 + 5.3 * smoothS(1 - u),
        };
      }
      if (x <= 18) {
        const u = (x + 20) / 38;
        return { y: 2 * Math.sin(u * Math.PI), z: -2.5 * Math.sin(u * Math.PI), r: 6.5 + 2.4 * Math.sin(u * Math.PI) };
      }
      const t = Math.min(1, (x - 18) / 28);
      // the neck rises, bulges a little to one side, then swings the head to z-
      return { y: 22 * smoothS(t) + 3 * Math.sin(t * Math.PI), z: -9 * smoothS(t) + 5 * Math.sin(t * Math.PI) ** 2, r: 6.5 - 3.2 * smoothS(t) };
    };
    for (let x = -64; x <= 46; x++) {
      const s = spine(x);
      slice(x, s.y, s.z, s.r, (dy, r) => (dy < -0.35 * r ? belly() : scale()), () => CORE);
    }
    // bone spikes along the back, neck and tail
    for (let x = -60; x <= 42; x += 3) {
      const s = spine(x);
      const base = Math.floor(s.r) + 1;
      const hgt = Math.max(1, Math.round(1 + s.r * 0.5));
      for (let k = 0; k < hgt; k++) put(x, s.y + base + k - 1, s.z, BONE);
    }
    // spade at the tail tip
    const tip = spine(-64);
    ellipsoid(-68, tip.y + 1, tip.z, 4.5, 1, 4, scale, CORE);
    lineThick([-70, tip.y + 1, tip.z], [-78, tip.y + 3, tip.z + 3], 1, BONE);

    // ---- legs: all four are different ----
    for (const s of [1, -1]) {
      ellipsoid(10, -2, s * 7, 4.5, 4.5, 3.2, scale, CORE); // shoulder muscle
      ellipsoid(-12, -2, s * 8, 5.5, 5.5, 3.8, scale, CORE); // thigh muscle
      if (s === 1) {
        // front leg reaching forward, claws spread
        limb([[10, -4, 7], [17, -9, 10], [26, -12, 10]], [4, 3], "minecraft:blackstone");
        paw([26, -12, 10], [1, -0.4, 0.1], 5);
        // hind leg tucked up under the body
        limb([[-12, -5, 8], [-5, -11, 10], [-15, -15, 9]], [5, 3], "minecraft:blackstone");
        limb([[-15, -15, 9], [-9, -19, 9]], [2], "minecraft:polished_blackstone");
        paw([-9, -19, 9], [1, -0.35, 0], 5);
      } else {
        // front leg folded against the chest
        limb([[10, -4, -7], [5, -12, -10], [13, -14, -9]], [4, 3], "minecraft:blackstone");
        paw([13, -14, -9], [1, -0.3, 0], 4);
        // hind leg trailing behind, toes pointing back
        limb([[-12, -5, -8], [-8, -10, -10], [-22, -13, -9]], [5, 3], "minecraft:blackstone");
        limb([[-22, -13, -9], [-30, -15, -8]], [2], "minecraft:polished_blackstone");
        paw([-30, -15, -8], [-1, -0.3, 0], 5);
      }
    }

    // ---- head (turned to the side with the neck, z offset = HZ) ----
    const HZ = spine(46).z;
    ellipsoid(47, 24, HZ, 5.5, 4.6, 4.8, scale, CORE); // skull
    ellipsoid(57, 22.6, HZ, 8.5, 2.4, 2.7, scale, CORE); // upper jaw and snout
    ellipsoid(54, 16.4, HZ, 7.5, 1.7, 2.3, belly, "minecraft:red_nether_bricks"); // lower jaw (open)
    ellipsoid(47, 19.5, HZ, 3.5, 2.6, 3.4, scale, CORE); // jaw joint
    for (let x = 50; x <= 63; x += 2) {
      const zs = x > 58 ? [-1, 1] : [-2, -1, 1, 2];
      for (const z of zs) {
        put(x, 20, z + HZ, BONE);
        if (x % 4 === 0) put(x, 19, z + HZ, BONE);
        put(x + 1, 19, z + HZ, BONE);
      }
    }
    for (let x = 56; x <= 64; x++) {
      put(x, 19, HZ, "minecraft:shroomlight"); // fire glowing in the throat
      put(x, 20, HZ, "minecraft:shroomlight");
    }
    for (const s of [-1, 1]) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(49 + ox, 25 + oy, HZ + s * 4, "minecraft:ochre_froglight"); // glowing eyes
      for (let k = 0; k <= 10; k++) {
        // horns sweep back and up
        const hx = 46 - k * 1.4;
        const hy = 26.5 + k * 0.75 - 0.02 * k * k;
        const hz = HZ + s * (3.2 + k * 0.5);
        const size = k < 5 ? 2 : 1;
        for (let ox = 0; ox < size; ox++) for (let oy = 0; oy < size; oy++) for (let oz = 0; oz < size; oz++) put(hx + ox, hy + oy, hz + oz, BONE);
      }
      for (let k = 0; k < 4; k++) put(43 - k * 1.5, 22 - k * 0.5, HZ + s * (5 + k * 0.6), BONE); // cheek spikes
    }

    // ---- FIRE BREATH: a curling, turbulent stream that widens and sinks ----
    const MX = 64; // mouth
    const MY = 19.5;
    const FL = 66; // length along x
    const fpath = (t) => ({
      x: MX + FL * t,
      y: MY - 38 * Math.pow(t, 1.7) + 1.8 * Math.sin(t * 13) * t,
      z: HZ - 10 * smoothS(t) + 3 * Math.sin(t * 9 + 1) * t,
      r: 0.9 + 7 * Math.pow(t, 0.85),
    });
    // hot yellow core near the mouth, orange body, red edge, grey smoke as it cools
    const fireBlock = (t, d) => {
      const heat = 1 - t * 0.75;
      const v = d + t * 0.55 + rnd() * 0.18;
      if (v < 0.3 * heat + 0.05) return chance(0.25) ? "minecraft:shroomlight" : "minecraft:yellow_stained_glass";
      if (v < 0.75) return chance(0.1) ? "minecraft:magma" : "minecraft:orange_stained_glass";
      if (v < 1.05) return "minecraft:red_stained_glass";
      return chance(0.5) ? "minecraft:gray_stained_glass" : "minecraft:black_stained_glass";
    };
    const FN = 95;
    for (let q = 0; q <= FN; q++) {
      const t = q / FN;
      const c = fpath(t);
      const R = Math.ceil(c.r) + 1;
      for (let ox = -R; ox <= R; ox++) {
        for (let oy = -R; oy <= R; oy++) {
          for (let oz = -R; oz <= R; oz++) {
            const d = Math.hypot(ox, oy, oz) / c.r;
            if (d > 1) continue;
            if (d > 0.82 && chance((d - 0.82) * 3.5)) continue; // ragged flickering edge
            put(c.x + ox, c.y + oy, c.z + oz, fireBlock(t, d));
          }
        }
      }
    }
    // tongues of flame licking out of the stream
    for (let k = 0; k < 14; k++) {
      const t0 = 0.12 + rnd() * 0.65;
      const c = fpath(t0);
      const ang = rnd() * Math.PI * 2;
      const len = 4 + rnd() * 9 * (0.5 + t0);
      const a = [c.x, c.y, c.z];
      const mid = [c.x + 3 + rnd() * 3, c.y + Math.sin(ang) * len * 0.6 + 2, c.z + Math.cos(ang) * len * 0.6];
      const b = [mid[0] + 4 + rnd() * 3, mid[1] + Math.sin(ang) * len * 0.4 - 2, mid[2] + Math.cos(ang) * len * 0.4];
      lineThick(a, mid, 2, "minecraft:orange_stained_glass");
      lineThick(mid, b, 1, chance(0.5) ? "minecraft:red_stained_glass" : "minecraft:orange_stained_glass");
    }
    // flying sparks and falling embers
    for (let k = 0; k < 90; k++) {
      const c = fpath(rnd());
      const reach = c.r + 5;
      put(c.x + (rnd() - 0.5) * 2 * reach, c.y + (rnd() - 0.5) * 2 * reach, c.z + (rnd() - 0.5) * 2 * reach, chance(0.5) ? "minecraft:magma" : "minecraft:shroomlight");
    }
    for (let k = 0; k < 22; k++) {
      const c = fpath(0.3 + rnd() * 0.7);
      const ex = c.x + (rnd() - 0.5) * 2 * c.r;
      const ez = c.z + (rnd() - 0.5) * 2 * c.r;
      const ey = c.y - c.r * 0.6;
      const drop = 3 + rnd() * 6;
      lineThick([ex, ey, ez], [ex, ey - drop, ez], 1, "minecraft:orange_stained_glass");
      put(ex, ey - drop - 1, ez, "minecraft:magma");
    }
    // smoke clouds drifting past the end of the flame
    const endF = fpath(1);
    for (let k = 0; k < 12; k++) {
      ellipsoid(endF.x + rnd() * 6, endF.y + (rnd() - 0.5) * 10, endF.z + (rnd() - 0.5) * 14, 2 + rnd() * 2, 1.5 + rnd() * 1.5, 2 + rnd() * 2, () => "minecraft:gray_stained_glass", "minecraft:gray_stained_glass");
    }

    // ---- turn the voxel map into fill commands (runs along x are merged) ----
    const rows = new Map();
    for (const [key, b] of vox) {
      const [x, y, z] = key.split(",").map(Number);
      const rk = `${b}|${y}|${z}`;
      let r = rows.get(rk);
      if (!r) rows.set(rk, (r = []));
      r.push(x);
    }
    for (const [rk, xs] of rows) {
      const [b, ys, zs] = rk.split("|");
      const y = Number(ys);
      const z = Number(zs);
      xs.sort((p, q) => p - q);
      let a = xs[0];
      let prev = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === prev + 1) {
          prev = xs[i];
          continue;
        }
        fill(a, y, z, prev, y, z, b);
        if (i < xs.length) {
          a = xs[i];
          prev = xs[i];
        }
      }
    }
  }

  // =====================================================================
  // 9. BORDER WALL around the whole arena (built last, so nothing can overwrite it)
  // =====================================================================
  {
    const BH = 24; // wall height above the floor
    const BW = 3; // wall thickness
    const WALL = "minecraft:stone_bricks";
    fill(X0, fy + 1, Z0, X1, fy + BH, Z0 + BW - 1, WALL); // north
    fill(X0, fy + 1, Z1 - BW + 1, X1, fy + BH, Z1, WALL); // south
    fill(X0, fy + 1, Z0 + BW, X0 + BW - 1, fy + BH, Z1 - BW, WALL); // west
    fill(X1 - BW + 1, fy + 1, Z0 + BW, X1, fy + BH, Z1 - BW, WALL); // east
    // dark band + battlements on top, lanterns every 20 blocks
    fill(X0, fy + BH - 1, Z0, X1, fy + BH - 1, Z0 + BW - 1, "minecraft:polished_blackstone_bricks");
    fill(X0, fy + BH - 1, Z1 - BW + 1, X1, fy + BH - 1, Z1, "minecraft:polished_blackstone_bricks");
    fill(X0, fy + BH - 1, Z0 + BW, X0 + BW - 1, fy + BH - 1, Z1 - BW, "minecraft:polished_blackstone_bricks");
    fill(X1 - BW + 1, fy + BH - 1, Z0 + BW, X1, fy + BH - 1, Z1 - BW, "minecraft:polished_blackstone_bricks");
    for (let k = 0; k < N; k += 2) {
      set(X0 + k, fy + BH + 1, Z0, WALL);
      set(X0 + k, fy + BH + 1, Z1, WALL);
      set(X0, fy + BH + 1, Z0 + k, WALL);
      set(X1, fy + BH + 1, Z0 + k, WALL);
    }
    for (let k = 10; k < N; k += 20) {
      set(X0 + k, fy + BH + 1, Z0 + 1, "minecraft:lantern");
      set(X0 + k, fy + BH + 1, Z1 - 1, "minecraft:lantern");
      set(X0 + 1, fy + BH + 1, Z0 + k, "minecraft:lantern");
      set(X1 - 1, fy + BH + 1, Z0 + k, "minecraft:lantern");
    }
  }

  // =====================================================================
  // 10. SKY TITLE: giant red block letters on TWO lines (TITLE_LINES) over the middle of the arena.
  //     Double sided (one plane reads correctly from the south, a mirrored one from the north).
  //     Letters are red concrete; invisible light blocks in front of every letter pixel
  //     keep them at full brightness, even at night. Lives in sections 4, 5 and 6, so
  //     !title (or /scriptevent jester:title) rebuilds just the title.
  // =====================================================================
  recording = true; // (title-only mode starts recording here)
  // always clear the old title area (any older size or mode), so nothing is left behind
  fill(X0, fy + TITLE_BASE - 2, cz - 5, X1, fy + TITLE_BASE + 180, cz + 4, AIR);
  if (TITLE_MODE === "blocks") {
    const FONT = {
      C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
      N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
      M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
      P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
      A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
      R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
      E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    };
    const blank = () => Array(7).fill(false);
    const buildCols = (text) => {
      const cols = [];
      for (const ch of text.toUpperCase()) {
        if (cols.length) cols.push(blank()); // gap between letters
        const g = FONT[ch];
        if (!g) {
          for (let k = 0; k < 3; k++) cols.push(blank()); // space / unknown letter
          continue;
        }
        for (let c = 0; c < 5; c++) cols.push(g.map((row) => row[c] === "#"));
      }
      return cols;
    };

    const lines = TITLE_LINES.map(buildCols);
    const maxCols = Math.max(...lines.map((l) => l.length));
    const TS = Math.max(1, Math.min(TITLE_SCALE, Math.floor((ARENA_SIZE - 12) / maxCols)));
    const TY = fy + TITLE_BASE;
    const LINE_STEP = 9 * TS; // 7 rows of letter + 2 rows of gap
    const RED = "minecraft:red_concrete";
    const LIGHT = 'minecraft:light_block ["block_light_level"=15]';

    lines.forEach((cols, li) => {
      const n = cols.length;
      const xStart = cx - Math.floor((n * TS) / 2);
      const lineY = TY + (lines.length - 1 - li) * LINE_STEP; // first line is the top one

      for (let r = 0; r < 7; r++) {
        const y1 = lineY + (6 - r) * TS;
        const y2 = y1 + TS - 1;
        let c = 0;
        while (c < n) {
          if (!cols[c][r]) {
            c++;
            continue;
          }
          let c2 = c;
          while (c2 + 1 < n && cols[c2 + 1][r]) c2++;
          // plane A (south side, reads left to right going east)
          fill(xStart + c * TS, y1, cz, xStart + (c2 + 1) * TS - 1, y2, cz + 1, RED);
          // plane B (north side, mirrored so it reads correctly from the north)
          fill(xStart + (n - 1 - c2) * TS, y1, cz - 2, xStart + (n - c) * TS - 1, y2, cz - 1, RED);
          c = c2 + 1;
        }
        // light blocks in front of every letter pixel, on both faces
        for (let cc = 0; cc < n; cc++) {
          if (!cols[cc][r]) continue;
          const yc = y1 + Math.floor(TS / 2);
          set(xStart + cc * TS + Math.floor(TS / 2), yc, cz + 2, LIGHT);
          set(xStart + (n - 1 - cc) * TS + Math.floor(TS / 2), yc, cz - 3, LIGHT);
        }
      }
    });
  }

  return { sections, totalCost, X0, X1, Z0, Z1, trees: trees + forestTrees, boulders };
}

// =====================================================================
// MOUNTAIN RING around the arena: !mountain  (or /scriptevent jester:mountain)
//   !mountain             build the whole ring (16 sections)
//   !mountain only 3 7    rebuild only those sections
//   !mountain seed 5      different shape
//
//   Sections (outer ring of a 5 x 5 grid, numbered row by row, the middle is the arena):
//        1   2   3   4   5
//        6   .   .   .   7
//        8   .   .   .   9
//       10   .   .   .  11
//       12  13  14  15  16
//
// The mountain is taller than the castle keep (82), so players inside the arena
// cannot see the outside of the map. It never touches the arena itself, and it
// never touches the spawn safe zone (stands, header and SPAWN_SAFE_MARGIN around them).
// Run it AFTER !arena. Re-running !arena does not rebuild or erase the mountain.
// =====================================================================
const MOUNTAIN_WIDTH = 80; // how far the ring reaches outside the arena border
const MOUNTAIN_PEAK = 120; // average crest height above the floor (castle keep = 82)
const MOUNTAIN_SNOWLINE = 105; // snow caps above this height
const MOUNTAIN_SEED = 777;
const MOUNTAIN_CLEAR_HEIGHT = 180; // old leftovers up to this height are removed first
const MOUNTAIN_PARK_HEIGHT = 200; // where the builder parks you (above the peaks)
const SPAWN_SAFE_MARGIN = 16; // blocks kept free around the spawn stands and header

// Rectangle around the spawn that the mountain never touches (computed from the stands)
function spawnSafeZone() {
  let x0 = SPAWN_TELEPORT.x;
  let x1 = SPAWN_TELEPORT.x;
  let z0 = SPAWN_TELEPORT.z;
  let z1 = SPAWN_TELEPORT.z;
  for (const s of STANDS) {
    x0 = Math.min(x0, s.location.x);
    x1 = Math.max(x1, s.location.x);
    z0 = Math.min(z0, s.location.z);
    z1 = Math.max(z1, s.location.z);
  }
  x0 = Math.min(x0, HEADER_POS.x);
  x1 = Math.max(x1, HEADER_POS.x);
  z0 = Math.min(z0, HEADER_POS.z);
  z1 = Math.max(z1, HEADER_POS.z);
  return {
    x0: Math.floor(x0 - SPAWN_SAFE_MARGIN),
    x1: Math.ceil(x1 + SPAWN_SAFE_MARGIN),
    z0: Math.floor(z0 - SPAWN_SAFE_MARGIN),
    z1: Math.ceil(z1 + SPAWN_SAFE_MARGIN),
  };
}

// Pure function (no game calls): returns the same shape as generateArena
function generateMountain(cx, cz, fy, seed, decorOnly = false) {
  const W = MOUNTAIN_WIDTH;
  const AX0 = cx - ARENA_HALF;
  const AX1 = cx + ARENA_HALF - 1;
  const AZ0 = cz - ARENA_HALF;
  const AZ1 = cz + ARENA_HALF - 1;
  const MX0 = AX0 - W;
  const MZ0 = AZ0 - W;
  const M = ARENA_SIZE + 2 * W;
  const per = 5;
  const C = Math.ceil(M / per);
  const safe = spawnSafeZone();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => t * t * (3 - 2 * t);

  // sections: the outer ring of a 5 x 5 grid (the middle 3 x 3 is the arena, skipped)
  const sections = [];
  const secOf = new Array(per * per).fill(null);
  for (let iz = 0; iz < per; iz++) {
    for (let ix = 0; ix < per; ix++) {
      if (ix >= 1 && ix <= per - 2 && iz >= 1 && iz <= per - 2) continue;
      const sec = {
        x0: MX0 + ix * C,
        x1: Math.min(MX0 + M - 1, MX0 + (ix + 1) * C - 1),
        z0: MZ0 + iz * C,
        z1: Math.min(MZ0 + M - 1, MZ0 + (iz + 1) * C - 1),
        ops: [],
      };
      sections.push(sec);
      secOf[iz * per + ix] = sec;
    }
  }
  let totalCost = 0;

  // one fill, split per section and per 32000 blocks
  const emitBox = (x1, y1, z1, x2, y2, z2, block) => {
    if (x1 > x2 || y1 > y2 || z1 > z2) return;
    const ix0 = Math.floor((x1 - MX0) / C);
    const ix1 = Math.floor((x2 - MX0) / C);
    const iz0 = Math.floor((z1 - MZ0) / C);
    const iz1 = Math.floor((z2 - MZ0) / C);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const sec = secOf[iz * per + ix];
        if (!sec) continue;
        const px0 = Math.max(x1, sec.x0);
        const px1 = Math.min(x2, sec.x1);
        const pz0 = Math.max(z1, sec.z0);
        const pz1 = Math.min(z2, sec.z1);
        if (px0 > px1 || pz0 > pz1) continue;
        const area = (px1 - px0 + 1) * (pz1 - pz0 + 1);
        const step = Math.max(1, Math.floor(32000 / area));
        for (let y = y1; y <= y2; y += step) {
          const ye = Math.min(y2, y + step - 1);
          const cost = 1 + Math.floor((area * (ye - y + 1)) / 3000);
          sec.ops.push([`fill ${px0} ${y} ${pz0} ${px1} ${ye} ${pz1} ${block}`, cost]);
          totalCost += cost;
        }
      }
    }
  };

  // same, but never inside the spawn safe zone
  const fillSafe = (x1, y1, z1, x2, y2, z2, block) => {
    if (x2 < safe.x0 || x1 > safe.x1 || z2 < safe.z0 || z1 > safe.z1) {
      emitBox(x1, y1, z1, x2, y2, z2, block);
      return;
    }
    if (z1 < safe.z0) emitBox(x1, y1, z1, x2, y2, safe.z0 - 1, block);
    if (z2 > safe.z1) emitBox(x1, y1, safe.z1 + 1, x2, y2, z2, block);
    const za = Math.max(z1, safe.z0);
    const zb = Math.min(z2, safe.z1);
    if (x1 < safe.x0) emitBox(x1, y1, za, safe.x0 - 1, y2, zb, block);
    if (x2 > safe.x1) emitBox(safe.x1 + 1, y1, za, x2, y2, zb, block);
  };

  // 1. clear the four slabs around the arena (old mountain leftovers)
  const topY = fy + MOUNTAIN_CLEAR_HEIGHT;
  const MX1 = MX0 + M - 1;
  const MZ1 = MZ0 + M - 1;
  if (!decorOnly) {
    fillSafe(MX0, fy + 1, MZ0, MX1, topY, AZ0 - 1, "minecraft:air");
    fillSafe(MX0, fy + 1, AZ1 + 1, MX1, topY, MZ1, "minecraft:air");
    fillSafe(MX0, fy + 1, AZ0, AX0 - 1, topY, AZ1, "minecraft:air");
    fillSafe(AX1 + 1, fy + 1, AZ0, MX1, topY, AZ1, "minecraft:air");
  }

  // 2. height map
  const hts = new Int16Array(M * M);
  for (let zi = 0; zi < M; zi++) {
    for (let xi = 0; xi < M; xi++) {
      const x = MX0 + xi;
      const z = MZ0 + zi;
      const d = Math.hypot(Math.max(AX0 - x, x - AX1, 0), Math.max(AZ0 - z, z - AZ1, 0));
      if (d <= 0 || d > W) continue; // inside the arena, or past the ring
      const sd = Math.hypot(Math.max(safe.x0 - x, x - safe.x1, 0), Math.max(safe.z0 - z, z - safe.z1, 0));
      if (sd <= 0) continue; // spawn safe zone: untouched

      const CREST = 48; // distance from the border where the crest sits
      const prof =
        d <= CREST
          ? 30 + (MOUNTAIN_PEAK - 30) * smooth(d / CREST)
          : MOUNTAIN_PEAK * (1 - smooth((d - CREST) / (W - CREST)));
      const n1 = valueNoise(x / 40, z / 40, seed + 1);
      const ridge = 1 - Math.abs(2 * valueNoise(x / 26, z / 26, seed + 5) - 1);
      const n2 = valueNoise(x / 15, z / 15, seed + 7);
      const n3 = valueNoise(x / 6, z / 6, seed + 9);
      let h = prof * (0.8 + 0.28 * n1 + 0.22 * ridge);
      h += ((n2 - 0.5) * 14 + (n3 - 0.5) * 5) * Math.min(1, prof / 40);
      h *= smooth(clamp(sd / 14, 0, 1)); // fade out next to the safe zone
      hts[zi * M + xi] = Math.max(0, Math.round(h));
    }
  }

  // 3. surface material from height and steepness
  const TOPS = [
    "minecraft:grass_block", // 0
    "minecraft:stone", // 1
    "minecraft:andesite", // 2
    "minecraft:tuff", // 3
    "minecraft:coarse_dirt", // 4
    "minecraft:gravel", // 5
    "minecraft:snow_block", // 6
    "minecraft:cobblestone", // 7
    "minecraft:calcite", // 8
  ];
  const tops = new Uint8Array(M * M);
  const hAt = (xi, zi, fallback) => (xi < 0 || xi >= M || zi < 0 || zi >= M ? fallback : hts[zi * M + xi]);
  for (let zi = 0; zi < M; zi++) {
    for (let xi = 0; xi < M; xi++) {
      const h = hts[zi * M + xi];
      if (h <= 0) continue;
      const slope = Math.max(
        Math.abs(h - hAt(xi + 1, zi, h)),
        Math.abs(h - hAt(xi - 1, zi, h)),
        Math.abs(h - hAt(xi, zi + 1, h)),
        Math.abs(h - hAt(xi, zi - 1, h))
      );
      const x = MX0 + xi;
      const z = MZ0 + zi;
      const p = valueNoise(x / 6, z / 6, seed + 19);
      const q = valueNoise(x / 23, z / 23, seed + 23);
      const snow = MOUNTAIN_SNOWLINE + (q - 0.5) * 24;
      let k;
      if (h >= snow && slope < 5) k = 6;
      else if (slope >= 3 || h >= 70) k = p < 0.45 ? 1 : p < 0.65 ? 2 : p < 0.8 ? 3 : p < 0.92 ? 7 : 8;
      else if (h < 24) k = p > 0.9 ? 4 : p > 0.84 ? 5 : 0;
      else k = p < 0.5 ? 0 : p < 0.7 ? 1 : p < 0.85 ? 4 : 5;
      tops[zi * M + xi] = k;
    }
  }

  // 4. turn the height map into fill commands (runs along x)
  for (let zi = 0; zi < M && !decorOnly; zi++) {
    const z = MZ0 + zi;
    let xi = 0;
    while (xi < M) {
      const i = zi * M + xi;
      const h = hts[i];
      if (h <= 0) {
        xi++;
        continue;
      }
      const k = tops[i];
      const cell = Math.floor(xi / C);
      let xj = xi + 1;
      while (xj < M && hts[zi * M + xj] === h && tops[zi * M + xj] === k && Math.floor(xj / C) === cell) xj++;
      const xa = MX0 + xi;
      const xb = MX0 + xj - 1;
      const y = fy + h;
      if (k === 0) {
        if (h >= 4) emitBox(xa, fy + 1, z, xb, y - 3, z, "minecraft:stone");
        if (h >= 2) emitBox(xa, fy + Math.max(1, h - 2), z, xb, y - 1, z, "minecraft:dirt");
      } else if (h >= 2) {
        emitBox(xa, fy + 1, z, xb, y - 1, z, "minecraft:stone");
      }
      emitBox(xa, y, z, xb, y, z, TOPS[k]);
      xi = xj;
    }
  }


  // =====================================================================
  // 5. LIFE ON THE MOUNTAIN: caves, giant statues, watchtowers, ancient gates, bone ribcages,
  //    camps, lantern posts, spruce + cherry forests, flowers, crystals and goats.
  //    Everything is placed on the height map above and only on free, solid ground.
  // =====================================================================
  const drnd = makeRng(seed + 4242);
  const rint = (a, b) => a + Math.floor(drnd() * (b - a + 1));
  const pick = (a) => a[Math.floor(drnd() * a.length)];
  const chance = (p) => drnd() < p;
  const AIR = "minecraft:air";
  const dpts = []; // [x, y, z, kind]  kind 0 = flame, 1 = sparkle
  const stats = { caves: 0, statues: 0, towers: 0, gates: 0, ribcages: 0, camps: 0, posts: 0, trees: 0, goats: 0 };

  const dput = (x, y, z, block) => emitBox(x, y, z, x, y, z, block);
  const dbox = (x1, y1, z1, x2, y2, z2, block) =>
    emitBox(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2), Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2), block);
  const emitCmd = (x, z, text) => {
    const ix = Math.floor((x - MX0) / C);
    const iz = Math.floor((z - MZ0) / C);
    const sec = ix >= 0 && ix < per && iz >= 0 && iz < per ? secOf[iz * per + ix] : null;
    if (!sec) return;
    sec.ops.push([text, 1]);
    totalCost += 1;
  };

  const hSurf = (x, z) => {
    const xi = x - MX0;
    const zi = z - MZ0;
    return xi < 0 || xi >= M || zi < 0 || zi >= M ? 0 : hts[zi * M + xi];
  };
  const kSurf = (x, z) => {
    const xi = x - MX0;
    const zi = z - MZ0;
    return xi < 0 || xi >= M || zi < 0 || zi >= M ? 0 : tops[zi * M + xi];
  };
  const used = new Set();
  const ckey = (x, z) => x * 100003 + z;
  const reserve = (x0, z0, x1, z1) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) used.add(ckey(x, z));
  };
  const isFree = (x0, z0, x1, z1) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (used.has(ckey(x, z))) return false;
    return true;
  };
  const footprint = (x0, z0, x1, z1) => {
    let mn = 9999;
    let mx = -1;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const h = hSurf(x, z);
        if (h <= 0) return null;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
    }
    return { min: mn, max: mx };
  };

  // side frames: pos(t, d) = world x, z at lateral offset t and distance d outside the arena border; fwd = toward the arena
  const SIDES = [
    { name: "N", fwd: [0, 1], pos: (t, d) => [cx + t, AZ0 - d] },
    { name: "S", fwd: [0, -1], pos: (t, d) => [cx + t, AZ1 + d] },
    { name: "W", fwd: [1, 0], pos: (t, d) => [AX0 - d, cz + t] },
    { name: "E", fwd: [-1, 0], pos: (t, d) => [AX1 + d, cz + t] },
  ];

  // tries flat ground first, then accepts steeper ground (the pad is filled with stone up to the highest point)
  const findSpot = (side, r, dMin, dMax, maxSlope) => {
    for (const extra of [0, 8, 16, 26]) {
      for (let tries = 0; tries < 80; tries++) {
        const t = rint(-125, 125);
        const d = rint(dMin, dMax);
        const [X, Z] = side.pos(t, d);
        const info = footprint(X - r, Z - r, X + r, Z + r);
        if (!info || info.max - info.min > maxSlope + extra) continue;
        if (!isFree(X - r - 2, Z - r - 2, X + r + 2, Z + r + 2)) continue;
        reserve(X - r - 1, Z - r - 1, X + r + 1, Z + r + 1);
        return { X, Z, r, min: fy + info.min, by: fy + info.max };
      }
    }
    return null;
  };
  // local frame: l = sideways, f = toward the arena, y = up from by (y 0 = the ground level of the pad)
  const frameOf = (side, spot) => {
    const fx = side.fwd[0];
    const fz = side.fwd[1];
    const lx = -fz;
    const lz = fx;
    const P = (l, f) => [spot.X + lx * l + fx * f, spot.Z + lz * l + fz * f];
    const by = spot.by;
    return {
      by,
      xz: P,
      box: (l1, f1, y1, l2, f2, y2, block) => {
        const [a, b] = P(l1, f1);
        const [c, d] = P(l2, f2);
        dbox(a, by + y1, b, c, by + y2, d, block);
      },
      blk: (l, f, y, block) => {
        const [a, b] = P(l, f);
        dput(a, by + y, b, block);
      },
    };
  };
  const padOf = (spot, block) => dbox(spot.X - spot.r, spot.min, spot.Z - spot.r, spot.X + spot.r, spot.by, spot.Z + spot.r, block);

  // ---------- giant knight statue (faces the arena) ----------
  const knight = (F) => {
    F.box(-6, -6, 1, 6, 6, 2, "minecraft:deepslate_bricks");
    F.box(-5, -5, 3, 5, 5, 3, "minecraft:polished_blackstone_bricks");
    for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) F.blk(a, b, 4, "minecraft:lantern");
    F.box(-3, -1, 4, -1, 1, 14, "minecraft:stone_bricks");
    F.box(1, -1, 4, 3, 1, 14, "minecraft:stone_bricks");
    F.box(-3, -2, 4, -1, 2, 5, "minecraft:polished_andesite");
    F.box(1, -2, 4, 3, 2, 5, "minecraft:polished_andesite");
    F.box(-4, -2, 15, 4, 2, 16, "minecraft:polished_andesite");
    F.box(-4, -2, 15, 4, 2, 15, "minecraft:gold_block");
    F.box(-5, -2, 17, 5, 2, 27, "minecraft:stone_bricks");
    F.box(-4, 3, 19, 4, 3, 26, "minecraft:polished_andesite");
    F.box(-1, 4, 21, 1, 4, 24, "minecraft:gold_block");
    F.box(-8, -3, 26, -6, 3, 29, "minecraft:polished_andesite");
    F.box(6, -3, 26, 8, 3, 29, "minecraft:polished_andesite");
    F.box(-8, -2, 17, -6, 2, 25, "minecraft:stone_bricks");
    F.box(6, -2, 17, 8, 2, 25, "minecraft:stone_bricks");
    F.box(-5, -4, 8, 5, -4, 27, "minecraft:red_wool");
    F.box(0, 6, 4, 0, 6, 22, "minecraft:iron_block");
    F.box(-3, 6, 23, 3, 6, 23, "minecraft:gold_block");
    F.box(0, 6, 24, 0, 6, 26, "minecraft:dark_oak_planks");
    F.blk(0, 6, 27, "minecraft:gold_block");
    F.box(-2, 5, 24, 2, 7, 25, "minecraft:polished_andesite");
    F.box(-2, -2, 28, 2, 2, 28, "minecraft:stone_bricks");
    F.box(-3, -3, 29, 3, 3, 34, "minecraft:stone_bricks");
    F.box(-3, -3, 34, 3, 3, 35, "minecraft:polished_andesite");
    F.box(-2, 3, 31, 2, 3, 31, "minecraft:black_concrete");
    F.blk(-1, 3, 31, "minecraft:glowstone");
    F.blk(1, 3, 31, "minecraft:glowstone");
    F.box(0, -3, 36, 0, 2, 40, "minecraft:red_concrete");
    const [ex, ez] = F.xz(0, 3);
    dpts.push([ex, F.by + 31, ez, 1], [ex, F.by + 5, ez, 0]);
  };

  // ---------- giant wizard statue ----------
  const wizard = (F) => {
    F.box(-6, -6, 1, 6, 6, 2, "minecraft:deepslate_bricks");
    F.box(-5, -5, 3, 5, 5, 3, "minecraft:polished_blackstone_bricks");
    for (const [a, b] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) F.blk(a, b, 4, "minecraft:soul_lantern");
    for (let k = 0; k <= 17; k++) {
      const half = 6 - Math.floor((k * 3) / 18);
      F.box(-half, -half, 4 + k, half, half, 4 + k, k === 0 ? "minecraft:gold_block" : "minecraft:purple_concrete");
    }
    F.box(-3, -3, 22, 3, 3, 28, "minecraft:purple_concrete");
    F.box(-4, -3, 27, 4, 3, 28, "minecraft:purple_concrete");
    F.box(-2, -2, 29, 2, 2, 33, "minecraft:smooth_sandstone");
    F.box(-1, 3, 24, 1, 3, 27, "minecraft:white_wool");
    F.blk(-1, 3, 31, "minecraft:sea_lantern");
    F.blk(1, 3, 31, "minecraft:sea_lantern");
    F.box(-5, -5, 34, 5, 5, 34, "minecraft:purple_concrete");
    for (let k = 0; k < 12; k++) {
      const half = Math.max(0, 4 - Math.floor(k / 3));
      F.box(-half, -half, 35 + k, half, half, 35 + k, "minecraft:purple_concrete");
    }
    F.blk(0, 0, 47, "minecraft:sea_lantern");
    F.box(2, 1, 26, 7, 3, 27, "minecraft:purple_concrete");
    F.box(7, 3, 1, 7, 3, 30, "minecraft:dark_oak_log");
    F.box(6, 2, 31, 8, 4, 33, "minecraft:sea_lantern");
    F.box(7, 3, 34, 7, 3, 36, "minecraft:end_rod");
    const [ox, oz] = F.xz(7, 3);
    dpts.push([ox, F.by + 32, oz, 1], [ox, F.by + 36, oz, 1]);
  };

  // ---------- watchtower on the crest ----------
  const tower = (F) => {
    F.box(-3, -3, 1, 3, 3, 14, "minecraft:stone_bricks");
    F.box(-2, -2, 1, 2, 2, 14, AIR);
    F.box(-2, -2, 7, 2, 2, 7, "minecraft:oak_planks");
    F.box(0, 3, 1, 0, 3, 2, AIR);
    for (const y of [4, 10]) {
      F.blk(-3, 0, y, AIR);
      F.blk(3, 0, y, AIR);
      F.blk(0, -3, y, AIR);
      F.blk(0, 3, y, AIR);
    }
    F.box(-4, -4, 15, 4, 4, 15, "minecraft:stone_bricks");
    for (let i = -4; i <= 4; i += 2) {
      F.blk(i, -4, 16, "minecraft:stone_bricks");
      F.blk(i, 4, 16, "minecraft:stone_bricks");
      F.blk(-4, i, 16, "minecraft:stone_bricks");
      F.blk(4, i, 16, "minecraft:stone_bricks");
    }
    F.blk(0, 0, 16, "minecraft:campfire");
    F.box(3, -3, 16, 3, -3, 25, "minecraft:oak_fence");
    F.box(4, -3, 22, 6, -3, 25, "minecraft:red_wool");
    F.blk(-1, 4, 2, "minecraft:lantern");
    F.blk(1, 4, 2, "minecraft:lantern");
    const [tx, tz] = F.xz(0, 0);
    dpts.push([tx, F.by + 17, tz, 0]);
  };

  // ---------- ancient gate ----------
  const gate = (F) => {
    F.box(-5, -2, 1, 5, 2, 1, "minecraft:polished_blackstone_bricks");
    F.box(-3, -1, 2, -2, 0, 11, "minecraft:polished_blackstone_bricks");
    F.box(2, -1, 2, 3, 0, 11, "minecraft:polished_blackstone_bricks");
    F.box(-3, -1, 12, 3, 0, 13, "minecraft:polished_blackstone_bricks");
    F.box(-1, 0, 2, 1, 0, 11, "minecraft:purple_stained_glass");
    for (const y of [4, 8]) {
      F.blk(-3, 1, y, "minecraft:crying_obsidian");
      F.blk(3, 1, y, "minecraft:crying_obsidian");
    }
    F.blk(-4, 0, 2, "minecraft:soul_lantern");
    F.blk(4, 0, 2, "minecraft:soul_lantern");
    F.blk(0, 0, 14, "minecraft:sea_lantern");
    const [gx, gz] = F.xz(0, 0);
    dpts.push([gx, F.by + 6, gz, 1]);
  };

  // ---------- bone ribcage ----------
  const ribcage = (F) => {
    for (let f = -6; f <= 6; f += 3) {
      for (let a = 0; a <= 180; a += 12) {
        const rad = (a * Math.PI) / 180;
        F.blk(Math.round(5.5 * Math.cos(rad)), f, 1 + Math.round(6 * Math.sin(rad)), "minecraft:bone_block");
      }
    }
    F.box(0, -7, 7, 0, 7, 7, "minecraft:bone_block");
    F.box(-1, 8, 1, 1, 10, 3, "minecraft:bone_block");
    F.blk(-1, 10, 3, "minecraft:soul_campfire");
  };

  // ---------- camp ----------
  const camp = (F) => {
    F.box(-3, -3, 0, 3, 3, 0, "minecraft:coarse_dirt");
    F.blk(0, 0, 1, "minecraft:campfire");
    F.blk(-2, 1, 1, "minecraft:hay_block");
    F.blk(-2, -1, 1, "minecraft:hay_block");
    F.blk(2, -2, 1, "minecraft:barrel");
    F.blk(2, 2, 1, "minecraft:barrel");
    F.box(1, -2, 1, 1, 2, 1, "minecraft:red_wool");
    F.box(5, -2, 1, 5, 2, 1, "minecraft:red_wool");
    F.box(2, -2, 2, 2, 2, 2, "minecraft:red_wool");
    F.box(4, -2, 2, 4, 2, 2, "minecraft:red_wool");
    F.box(3, -2, 3, 3, 2, 3, "minecraft:red_wool");
    F.box(-3, -3, 1, -3, -3, 3, "minecraft:cobblestone_wall");
    F.blk(-3, -3, 4, "minecraft:lantern");
    const [cxp, czp] = F.xz(0, 0);
    dpts.push([cxp, F.by + 2, czp, 0]);
  };

  // ---------- caves ----------
  const buildCave = (side, kind) => {
    const fx = side.fwd[0];
    const fz = side.fwd[1];
    const L = 26;
    for (let tries = 0; tries < 160; tries++) {
      const t = rint(-120, 120);
      const d = rint(8, 24);
      const [X, Z] = side.pos(t, d);
      const h0 = hSurf(X, Z);
      if (h0 < 34 || h0 > 88) continue;
      let ok = true;
      for (let s = 8; s <= L + 12; s += 4) {
        if (hSurf(X - fx * s, Z - fz * s) < h0 + 8) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      // the chamber (radius 7, 10 high) needs solid rock all around and above it
      const ccx = X - fx * (L + 4);
      const ccz = Z - fz * (L + 4);
      for (const [ox, oz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
        if (hSurf(ccx + ox, ccz + oz) < h0 + 14) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ex = X - fx * (L + 12);
      const ez = Z - fz * (L + 12);
      const x0 = Math.min(X, ex) - 10;
      const x1 = Math.max(X, ex) + 10;
      const z0 = Math.min(Z, ez) - 10;
      const z1 = Math.max(Z, ez) + 10;
      if (!isFree(x0, z0, x1, z1)) continue;
      reserve(x0, z0, x1, z1);

      const F = frameOf(side, { X, Z, by: fy + h0 });
      const fc = -(L + 4);
      const R = 7;
      // tunnel
      F.box(-2, -(L + 8), 1, 2, 3, 5, AIR);
      F.box(-2, -(L + 8), 0, 2, 3, 0, kind === 0 ? "minecraft:polished_deepslate" : "minecraft:blackstone");
      F.box(-3, -(L + 8), 0, -3, 3, 0, "minecraft:cobbled_deepslate");
      F.box(3, -(L + 8), 0, 3, 3, 0, "minecraft:cobbled_deepslate");
      for (let f = -4; f >= -(L + 2); f -= 5) {
        F.blk(-3, f, 3, kind === 0 ? "minecraft:sea_lantern" : "minecraft:shroomlight");
        F.blk(3, f, 3, kind === 0 ? "minecraft:sea_lantern" : "minecraft:shroomlight");
      }
      // entrance frame
      F.box(-4, -1, -3, -3, 1, 7, "minecraft:deepslate_bricks");
      F.box(3, -1, -3, 4, 1, 7, "minecraft:deepslate_bricks");
      F.box(-4, -1, 6, 4, 1, 7, "minecraft:deepslate_bricks");
      F.blk(-2, 1, 5, 'minecraft:lantern ["hanging"=true]');
      F.blk(2, 1, 5, 'minecraft:lantern ["hanging"=true]');
      F.blk(-5, 1, 1, "minecraft:moss_block");
      F.blk(5, 1, 1, "minecraft:moss_block");
      // chamber
      for (let y = -R; y <= R; y++) {
        for (let f = -R; f <= R; f++) {
          const rem = R * R - y * y - f * f;
          if (rem < 0) continue;
          const w = Math.floor(Math.sqrt(rem) + 0.3);
          F.box(-w, fc + f, 3 + y, w, fc + f, 3 + y, AIR);
        }
      }
      F.box(-R, fc - R, -5, R, fc + R, -1, "minecraft:stone");
      F.box(-R, fc - R, 0, R, fc + R, 0, kind === 0 ? "minecraft:smooth_basalt" : "minecraft:blackstone");
      if (kind === 0) {
        F.box(-3, fc - 3, 0, 3, fc + 3, 0, "minecraft:water");
        F.blk(0, fc, -1, "minecraft:sea_lantern");
        F.box(0, fc, 1, 0, fc, 5, "minecraft:amethyst_block");
        F.blk(0, fc, 6, "minecraft:amethyst_cluster");
        for (let i = 0; i < 40; i++) {
          const l = rint(-R + 1, R - 1);
          const f = rint(-R + 1, R - 1);
          const rem = R * R - l * l - f * f;
          if (rem < 4) continue;
          const yv = Math.floor(Math.sqrt(rem));
          F.blk(l, fc + f, 3 + yv, chance(0.5) ? "minecraft:amethyst_block" : "minecraft:sea_lantern");
          if (chance(0.5)) F.box(l, fc + f, 3 + yv - rint(1, 3), l, fc + f, 3 + yv - 1, "minecraft:dripstone_block");
        }
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          F.blk(Math.round(5 * Math.cos(a)), fc + Math.round(5 * Math.sin(a)), 1, "minecraft:amethyst_cluster");
        }
        const [px, pz] = F.xz(0, fc);
        dpts.push([px, F.by + 4, pz, 1], [px, F.by + 2, pz, 1]);
      } else {
        F.box(-3, fc - 3, 0, 3, fc + 3, 0, "minecraft:lava");
        F.box(-4, fc - 4, 1, -4, fc + 4, 2, "minecraft:iron_bars");
        F.box(4, fc - 4, 1, 4, fc + 4, 2, "minecraft:iron_bars");
        F.box(-4, fc - 4, 1, 4, fc - 4, 2, "minecraft:iron_bars");
        F.box(-4, fc + 4, 1, 4, fc + 4, 2, "minecraft:iron_bars");
        for (let i = 0; i < 24; i++) {
          const l = rint(-R + 1, R - 1);
          const f = rint(-R + 1, R - 1);
          if (Math.abs(l) <= 4 && Math.abs(f) <= 4) continue;
          if (R * R - l * l - f * f < 4) continue;
          F.blk(l, fc + f, 0, "minecraft:magma");
        }
        for (let i = 0; i < 40; i++) {
          const l = rint(-R + 1, R - 1);
          const f = rint(-R + 1, R - 1);
          const rem = R * R - l * l - f * f;
          if (rem < 4) continue;
          const yv = Math.floor(Math.sqrt(rem));
          F.blk(l, fc + f, 3 + yv, chance(0.5) ? "minecraft:shroomlight" : "minecraft:magma");
        }
        F.blk(-6, fc, 1, "minecraft:soul_campfire");
        F.blk(6, fc, 1, "minecraft:soul_campfire");
        F.blk(0, fc + 6, 1, "minecraft:campfire");
        const [px, pz] = F.xz(0, fc);
        dpts.push([px, F.by + 2, pz, 0], [px, F.by + 4, pz, 0]);
      }
      const [mx, mz] = F.xz(0, 2);
      dpts.push([mx, F.by + 4, mz, 0]);
      stats.caves++;
      return true;
    }
    return false;
  };

  // ---------- place everything ----------
  for (const side of SIDES) {
    for (let i = 0; i < 2; i++) buildCave(side, i);
  }
  for (const side of SIDES) {
    const order = chance(0.5) ? [knight, wizard] : [wizard, knight];
    for (const fn of order) {
      const spot = findSpot(side, 9, 40, 54, 18);
      if (!spot) continue;
      padOf(spot, "minecraft:stone");
      fn(frameOf(side, spot));
      stats.statues++;
    }
  }
  for (const side of SIDES) {
    for (let i = 0; i < 2; i++) {
      const spot = findSpot(side, 4, 38, 56, 14);
      if (!spot) continue;
      padOf(spot, "minecraft:stone_bricks");
      tower(frameOf(side, spot));
      stats.towers++;
    }
    const gs = findSpot(side, 5, 18, 36, 18);
    if (gs) {
      padOf(gs, "minecraft:polished_blackstone_bricks");
      gate(frameOf(side, gs));
      stats.gates++;
    }
    const rs = findSpot(side, 8, 22, 46, 20);
    if (rs) {
      padOf(rs, "minecraft:coarse_dirt");
      ribcage(frameOf(side, rs));
      stats.ribcages++;
    }
    for (let i = 0; i < 3; i++) {
      const cs = findSpot(side, 4, 4, 22, 16);
      if (!cs) continue;
      padOf(cs, "minecraft:coarse_dirt");
      camp(frameOf(side, cs));
      stats.camps++;
    }
  }

  // lantern posts along the slopes
  for (const side of SIDES) {
    for (let i = 0; i < 10; i++) {
      const t = rint(-135, 135);
      const d = rint(3, 36);
      const [X, Z] = side.pos(t, d);
      const h = hSurf(X, Z);
      if (h <= 0 || !isFree(X, Z, X, Z)) continue;
      reserve(X, Z, X, Z);
      const y = fy + h;
      dbox(X, y + 1, Z, X, y + 3, Z, "minecraft:cobblestone_wall");
      dput(X, y + 4, Z, "minecraft:lantern");
      dpts.push([X, y + 4, Z, 0]);
      stats.posts++;
    }
  }

  // forests, flowers, crystals (every free grass / stone cell of the ring)
  const PLANTS = [
    "minecraft:short_grass", "minecraft:short_grass", "minecraft:short_grass", "minecraft:fern",
    "minecraft:poppy", "minecraft:dandelion", "minecraft:cornflower", "minecraft:azure_bluet",
    "minecraft:allium", "minecraft:oxeye_daisy", "minecraft:pink_tulip",
  ];
  const SLEAF = 'minecraft:spruce_leaves ["persistent_bit"=true]';
  const CLEAF = 'minecraft:cherry_leaves ["persistent_bit"=true]';
  const spruce = (x, y, z) => {
    const H = rint(7, 12);
    const layers = [0, 1, 1, 2, 2, 3, 2, 3, 3];
    for (let j = 0; j < layers.length && j < H - 2; j++) {
      const r = layers[j];
      dbox(x - r, y + H - j, z - r, x + r, y + H - j, z + r, SLEAF);
    }
    dput(x, y + H + 1, z, SLEAF);
    dbox(x, y + 1, z, x, y + H, z, "minecraft:spruce_log");
  };
  const cherry = (x, y, z) => {
    const H = rint(5, 7);
    for (let dy = -2; dy <= 2; dy++) {
      const r = 4 - Math.abs(dy);
      dbox(x - r, y + H + dy, z - r, x + r, y + H + dy, z + r, CLEAF);
    }
    dbox(x, y + 1, z, x, y + H, z, "minecraft:cherry_log");
  };
  for (let zi = 0; zi < M; zi += 1) {
    for (let xi = 0; xi < M; xi += 1) {
      const h = hts[zi * M + xi];
      if (h < 6) continue;
      const x = MX0 + xi;
      const z = MZ0 + zi;
      const k = tops[zi * M + xi];
      const y = fy + h;
      const nearArena = x >= AX0 - 5 && x <= AX1 + 5 && z >= AZ0 - 5 && z <= AZ1 + 5;
      const grassy = (k === 0 || k === 4) && h <= 72;
      const rocky = (k === 1 || k === 2 || k === 3 || k === 5) && h >= 18 && h <= 85;
      if (!nearArena && (grassy || rocky) && chance(grassy ? 0.02 : 0.003) && isFree(x - 2, z - 2, x + 2, z + 2)) {
        reserve(x - 2, z - 2, x + 2, z + 2);
        if (chance(0.16)) cherry(x, y, z);
        else spruce(x, y, z);
        stats.trees++;
        continue;
      }
      if (k === 0 && h <= 72 && chance(0.016) && isFree(x, z, x, z)) {
        dput(x, y + 1, z, pick(PLANTS));
        continue;
      }
      if ((k === 1 || k === 2 || k === 3) && h >= 30 && chance(0.0009) && isFree(x, z, x, z)) {
        dput(x, y + 1, z, "minecraft:amethyst_cluster");
        if (chance(0.3)) dpts.push([x, y + 2, z, 1]);
      }
    }
  }

  // goats climbing the rocks
  for (const sec of sections) {
    emitCmd(
      sec.x0,
      sec.z0,
      `kill @e[type=minecraft:goat,x=${sec.x0},y=${fy},z=${sec.z0},dx=${sec.x1 - sec.x0},dy=250,dz=${sec.z1 - sec.z0}]`
    );
  }
  for (const side of SIDES) {
    let placed = 0;
    for (let tries = 0; tries < 200 && placed < 6; tries++) {
      const t = rint(-130, 130);
      const d = rint(8, 40);
      const [X, Z] = side.pos(t, d);
      const h = hSurf(X, Z);
      if (h < 35 || h > 90) continue;
      const k = kSurf(X, Z);
      if (k === 0 || k === 6) continue;
      emitCmd(X, Z, `summon minecraft:goat ${X + 0.5} ${fy + h + 1} ${Z + 0.5}`);
      placed++;
      stats.goats++;
    }
  }

  return { sections, totalCost, X0: MX0, X1: MX1, Z0: MZ0, Z1: MZ1, points: dpts.slice(0, 160), stats };
}

// ---------------------------------------------------------------------
// Commands: work for EVERYONE as chat messages (!arena, !title, !mountain, !ping),
// and as /scriptevent for operators.
// ---------------------------------------------------------------------

function canUseArenaCommands(player) {
  return ARENA_COMMANDS_FOR_EVERYONE || player.hasTag(ARENA_ADMIN_TAG);
}

// Reads "only 2 4 6 8" from the command words (stops at the next keyword); max = highest section number
function parseOnly(words, max) {
  const oi = words.indexOf("only");
  if (oi < 0) return null;
  const list = [];
  for (let k = oi + 1; k < words.length; k++) {
    const n = Number(words[k]);
    if (!Number.isInteger(n) || n < 1 || n > max) break;
    list.push(n);
  }
  return list.length ? list : null;
}

// id = "arena" | "title" | "mountain" | "ping", message = the words after the command
function runArenaCommand(player, id, message) {
  if (!player || player.typeId !== "minecraft:player") return;

  if (id === "ping") {
    player.sendMessage("§aJester script is running. Commands: !arena  !arena here  !title  !title here  !mountain");
    return;
  }

  if (!canUseArenaCommands(player)) {
    player.sendMessage("§cYou need the tag \"" + ARENA_ADMIN_TAG + "\" to use this command.");
    return;
  }

  const words = (message || "").trim().toLowerCase().split(/\s+/);
  const here = words.includes("here");

  if (id === "title") {
    buildArena(player, { here, seed: ARENA_SEED, only: [4, 5, 6], titleOnly: true });
    return;
  }

  if (id === "mountain") {
    const opts = { seed: MOUNTAIN_SEED, only: parseOnly(words, 16), arenaIndex: parseArenaNumber(words), decorOnly: words.includes("decor") };
    const si = words.indexOf("seed");
    if (si >= 0 && words[si + 1] !== undefined && Number.isFinite(Number(words[si + 1]))) opts.seed = Number(words[si + 1]);
    buildMountain(player, opts);
    return;
  }

  if (id === "arenas") {
    showArenaStatus(player);
    return;
  }

  if (id === "arena") {
    const opts = { here, seed: ARENA_SEED, only: parseOnly(words, 9) };

    // seed 42
    const si = words.indexOf("seed");
    if (si >= 0 && words[si + 1] !== undefined && Number.isFinite(Number(words[si + 1]))) {
      opts.seed = Number(words[si + 1]);
      opts.seedGiven = true;
    }

    // copy = build the next copy of the first arena;  copy 2 = rebuild arena number 2 (use with "only")
    const ci = words.indexOf("copy");
    if (ci >= 0) {
      opts.copy = true;
      const nn = Number(words[ci + 1]);
      if (Number.isInteger(nn) && nn >= 2) opts.copyIndex = nn - 1;
    }

    buildArena(player, opts);
  }
}

// "arena 2" in a command = the second arena (1 = the first one). Returns the 0-based index.
function parseArenaNumber(words) {
  const ai = words.indexOf("arena");
  if (ai < 0) return 0;
  const n = Number(words[ai + 1]);
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0;
}

// Chat commands for everyone: !arena  !title  !mountain  !ping
try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = (ev.message || "").trim();
    if (!msg.startsWith("!")) return;
    const parts = msg.slice(1).split(/\s+/);
    const id = (parts.shift() || "").toLowerCase();
    if (id !== "arena" && id !== "title" && id !== "mountain" && id !== "ping" && id !== "arenas") return; // normal chat
    ev.cancel = true; // do not show the command as a chat message
    const player = ev.sender;
    system.run(() => runArenaCommand(player, id, parts.join(" ")));
  });
} catch (e) {
}

// /scriptevent for operators (same commands)
// Use it with any text after the id, e.g.  /scriptevent jester:mountain go
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const map = { "jester:arena": "arena", "jester:title": "title", "jester:mountain": "mountain", "jester:ping": "ping", "jester:arenas": "arenas" };
  const id = map[ev.id];
  if (!id) return;
  console.warn(`[arena] received ${ev.id} "${ev.message}" (source: ${ev.sourceType})`);

  let player = ev.sourceEntity;
  // command block / server console / function: use the first player online
  if (!player || player.typeId !== "minecraft:player") player = world.getAllPlayers()[0];
  if (!player) return;

  try {
    player.sendMessage(`§7Got ${ev.id}, starting...`);
  } catch (e) {}
  // start one moment later so the message above shows before the heavy work begins
  system.runTimeout(() => {
    try {
      runArenaCommand(player, id, ev.message);
    } catch (e) {
      arenaBusy = false;
      console.warn(`[arena] ${ev.id} failed: ${e}`);
      try {
        player.sendMessage("§cCommand failed: " + e);
      } catch (e2) {}
    }
  }, 2);
});

// ---------------------------------------------------------------------
// Running the generated commands in the game
// ---------------------------------------------------------------------

function buildArena(player, opts) {
  if (arenaBusy) {
    player.sendMessage("§cThe arena is already being built.");
    return;
  }
  arenaBusy = true;
  try {
    const dim = world.getDimension(DIMENSION);

    // ---- COPY of the first arena (same layout, another place): !arena copy ----
    if (opts.copy) {
      const copies = getArenaCopies();
      const a0 = getActiveArena();
      let idx = opts.copyIndex ?? copies.length + 1; // arena index: 1 = second arena
      if (idx > copies.length + 1) idx = copies.length + 1;
      const existing = copies[idx - 1];
      const cx = existing ? existing.cx : a0.cx + ARENA_SPACING * idx;
      const cz = existing ? existing.cz : a0.cz;
      const fy = existing ? existing.fy : a0.fy;
      let seed = ARENA_SEED;
      try {
        const s = world.getDynamicProperty(ARENA_SEED_KEY);
        if (typeof s === "number") seed = s;
      } catch (e) {}
      if (opts.seedGiven) seed = opts.seed;
      const gen = generateArena(cx, cz, fy, seed, false);
      const minutes = Math.max(1, Math.round(gen.totalCost / ARENA_BUDGET / 20 / 60));
      const which = opts.only ? `sections ${opts.only.join(", ")} only` : `all ${gen.sections.length} sections`;
      player.sendMessage(
        `§eBuilding arena ${idx + 1} (a copy of arena 1, seed ${seed}) at ${cx}, ${fy}, ${cz}, ${which}. ` +
          `Takes about ${minutes}+ minute(s). You will be moved around. Stay in the world.`
      );
      runArenaSections(player, dim, gen, fy, {
        ...opts,
        onFinish: () => {
          if (!existing) saveArenaCopies([...getArenaCopies(), { cx, cz, fy }]);
          world.sendMessage(`§a§lArena ${idx + 1} is ready!§r §7Players now fill arena 1 first (max ${MAX_PER_ROLE} per role), then arena ${idx + 1}.`);
        },
      });
      return;
    }

    // title-only builds go where the arena was last built (unless "here")
    const base = opts.titleOnly && !opts.here ? getActiveArena() : { cx: ARENA_CENTER.x, cz: ARENA_CENTER.z, fy: ARENA_CENTER.floorY };
    const cx = opts.here ? Math.floor(player.location.x) : base.cx;
    const cz = opts.here ? Math.floor(player.location.z) : base.cz;
    const fy = opts.here ? Math.floor(player.location.y) - 1 : base.fy;
    if (!opts.titleOnly) {
      setActiveArena(cx, cz, fy); // the role stands teleport to the camps of THIS arena
      try {
        world.setDynamicProperty(ARENA_SEED_KEY, opts.seed); // the copies use the same layout
      } catch (e) {}
    }

    const gen = generateArena(cx, cz, fy, opts.seed, !!opts.titleOnly);
    const minutes = Math.max(1, Math.round(gen.totalCost / ARENA_BUDGET / 20 / 60));
    const which = opts.only ? `sections ${opts.only.join(", ")} only` : `all ${gen.sections.length} sections`;
    player.sendMessage(
      opts.titleOnly
        ? `§eUpdating the sky title "${ARENA_TITLE}" over ${cx}, ${cz} (${TITLE_MODE} mode). Takes under a minute. You will be moved around. Stay in the world.`
        : `§eBuilding the 300x300 arena at ${cx}, ${fy}, ${cz} (seed ${opts.seed}), ${which}. ` +
            `Takes about ${minutes}+ minute(s). You will be moved around the arena. Stay in the world.`
    );

    runArenaSections(player, dim, gen, fy, opts);
  } catch (e) {
    arenaBusy = false;
    player.sendMessage("§cArena failed to start: " + e);
    console.warn("[arena] failed to start: " + e);
  }
}

// Builds the mountain ring around the arena that was built last
function buildMountain(player, opts) {
  if (arenaBusy) {
    player.sendMessage("§cThe arena (or mountain) is already being built.");
    return;
  }
  arenaBusy = true;
  try {
    const dim = world.getDimension(DIMENSION);
    const a = getArenaByIndex(opts.arenaIndex ?? 0); // !mountain arena 2 = the mountain ring of the copy
    const gen = generateMountain(a.cx, a.cz, a.fy, opts.seed, !!opts.decorOnly);
    if (a.index === 0) setMountainPoints(gen.points); // copies reuse these points, shifted
    const st = gen.stats;
    const z = spawnSafeZone();
    const minutes = Math.max(1, Math.round(gen.totalCost / ARENA_BUDGET / 20 / 60));
    const which = opts.only ? `sections ${opts.only.join(", ")} only` : `all ${gen.sections.length} sections`;
    player.sendMessage(
      `§eMountain life: ${st.caves} caves, ${st.statues} giant statues, ${st.towers} towers, ${st.gates} gates, ${st.ribcages} ribcages, ` +
        `${st.camps} camps, ${st.posts} lantern posts, ${st.trees} trees, ${st.goats} goats.`
    );
    player.sendMessage(
      (opts.decorOnly ? "§eAdding the structures to the existing mountain ring" : "§eBuilding the mountain ring") +
        ` around arena ${a.index + 1} at ${a.cx}, ${a.cz} (seed ${opts.seed}), ${which}. ` +
        `Takes about ${minutes}+ minute(s). The spawn safe zone (x ${z.x0}..${z.x1}, z ${z.z0}..${z.z1}) is left untouched. ` +
        `You will be moved around. Stay in the world.`
    );
    runArenaSections(player, dim, gen, a.fy, {
      only: opts.only,
      parkY: MOUNTAIN_PARK_HEIGHT,
      label: "Mountain",
      cmd: "mountain",
    });
  } catch (e) {
    arenaBusy = false;
    player.sendMessage("§cMountain failed to start: " + e);
    console.warn("[mountain] failed to start: " + e);
  }
}

function runArenaSections(player, dim, gen, fy, opts = {}) {
  // Keep the real section number with each section so messages match the section maps
  const secs = gen.sections
    .map((sec, i) => ({ sec, num: i + 1 }))
    .filter((s) => !opts.only || opts.only.includes(s.num));

  const planned = secs.reduce((n, s) => n + s.sec.ops.reduce((m, op) => m + op[1], 0), 0) || 1;
  const midX = Math.floor((gen.X0 + gen.X1) / 2);
  const midZ = Math.floor((gen.Z0 + gen.Z1) / 2);

  let doneCost = 0;
  let skipped = 0; // harmless failures (e.g. "keep" on an occupied block, "no targets" on kill)
  let lost = 0; // steps that never ran because their chunk would not load
  let si = 0;

  const bar = (text) => {
    try {
      player.onScreenDisplay.setActionBar(text);
    } catch (e) {}
  };

  const areaName = (n) => `${ARENA_AREA_NAME}_${n}`;
  const removeArea = (name) => {
    try {
      dim.runCommand(`tickingarea remove ${name}`);
    } catch (e) {}
  };
  const clearAllAreas = () => {
    removeArea(ARENA_AREA_NAME); // the old single name from earlier versions
    for (let n = 1; n <= 16; n++) removeArea(areaName(n));
  };

  const isLoaded = (x, z) => {
    try {
      return !!dim.getBlock({ x, y: fy, z });
    } catch (e) {
      return false;
    }
  };

  // A section counts as loaded only when a grid of points (every 16 blocks) is all loaded
  const sectionLoaded = (sec) => {
    for (let x = sec.x0; x <= sec.x1 + 15; x += 16) {
      for (let z = sec.z0; z <= sec.z1 + 15; z += 16) {
        if (!isLoaded(Math.min(x, sec.x1), Math.min(z, sec.z1))) return false;
      }
    }
    return true;
  };

  // Was a failed command caused by an unloaded chunk? (command text: "<cmd> x y z ...")
  const opLoaded = (cmd) => {
    const p = cmd.split(" ");
    const o = p[0] === "summon" ? 1 : 0; // summon <type> x y z
    const x = Number(p[1 + o]);
    const y = Number(p[2 + o]);
    const z = Number(p[3 + o]);
    if (![x, y, z].every(Number.isFinite)) return true;
    try {
      return !!dim.getBlock({ x, y, z });
    } catch (e) {
      return false;
    }
  };

  // Put the player in the middle of the section, high up, so the game loads it for sure
  const moveToSection = (sec) => {
    try {
      player.teleport(
        { x: (sec.x0 + sec.x1) / 2 + 0.5, y: fy + (opts.parkY ?? 60), z: (sec.z0 + sec.z1) / 2 + 0.5 },
        { dimension: dim }
      );
    } catch (e) {
      console.warn("[arena] teleport failed: " + e);
    }
    try {
      player.addEffect("slow_falling", 20000, { amplifier: 0, showParticles: false });
    } catch (e) {}
  };

  const finish = () => {
    clearAllAreas();
    try {
      player.removeEffect("slow_falling");
    } catch (e) {}
    try {
      player.teleport({ x: midX + 0.5, y: fy + 45, z: midZ + 0.5 }, { dimension: dim });
      player.addEffect("slow_falling", 400, { amplifier: 0, showParticles: false });
    } catch (e) {}
    arenaBusy = false;
    try {
      if (opts.onFinish) opts.onFinish();
    } catch (e) {
      console.warn("[arena] onFinish failed: " + e);
    }
    world.sendMessage(
      `§a${opts.label ?? "Arena"} finished! (${skipped} harmless skipped steps, ${lost} steps lost to unloaded chunks). ` +
        (lost > 0
          ? `§eSome parts did not load. Run !${opts.cmd ?? "arena"} only <section numbers> to redo them.`
          : `Go there with /tp @s ${midX} ${fy + 25} ${midZ}`)
    );
  };

  const runOps = (item) => {
    const sec = item.sec;
    let i = 0;
    let stall = 0;
    const id = system.runInterval(() => {
      let budget = ARENA_BUDGET;
      while (i < sec.ops.length && budget > 0) {
        const op = sec.ops[i];
        try {
          dim.runCommand(op[0]);
        } catch (e) {
          const loaded = opLoaded(op[0]);
          if (!loaded && stall < ARENA_STALL_TIMEOUT) {
            // Chunk not ready: stop for this tick and retry this SAME step next tick,
            // so the build order is never broken.
            stall++;
            break;
          }
          if (!loaded) lost++;
          else skipped++;
        }
        stall = 0;
        i++;
        budget -= op[1];
        doneCost += op[1];
      }
      bar(
        `§6Building ${(opts.label ?? "arena").toLowerCase()}: section ${item.num} (${si + 1}/${secs.length})  ` +
          `${Math.min(100, Math.floor((doneCost / planned) * 100))}%` +
          (stall > 0 ? "  §7waiting for chunks..." : "")
      );
      if (i >= sec.ops.length) {
        system.clearRun(id);
        removeArea(areaName(item.num));
        si++;
        startSection();
      }
    }, 1);
  };

  const startSection = () => {
    if (si >= secs.length) {
      finish();
      return;
    }
    const item = secs[si];
    const sec = item.sec;

    // Move the player there first, then also add a ticking area with its own unique name
    moveToSection(sec);
    removeArea(areaName(item.num));
    try {
      dim.runCommand(`tickingarea add ${sec.x0} ${fy} ${sec.z0} ${sec.x1} ${fy} ${sec.z1} ${areaName(item.num)}`);
    } catch (e) {
      console.warn(`[arena] tickingarea add failed for section ${item.num}: ${e}`);
    }

    let waited = 0;
    const waitId = system.runInterval(() => {
      waited += 5;
      const loaded = sectionLoaded(sec);
      if (loaded || waited >= ARENA_LOAD_TIMEOUT) {
        system.clearRun(waitId);
        if (!loaded) console.warn(`[arena] section ${item.num} chunks did not finish loading, building anyway`);
        // short pause so the chunks settle before the first command
        system.runTimeout(() => runOps(item), 20);
      } else {
        // keep the player parked over the section while it loads
        if (waited % 100 === 0) moveToSection(sec);
        bar(`§6Loading ${(opts.label ?? "arena").toLowerCase()} section ${item.num} (${si + 1}/${secs.length})...`);
      }
    }, 5);
  };

  clearAllAreas();
  startSection();
}

// =====================================================================
// LOGO REMOVED FOR GOOD + BRIGHT ARENA + NO MOB SPAWNING
// (replaces the old CNMB ARENA LOGO block)
// =====================================================================

// ---------- 1. delete every leftover logo (and its invisible light blocks) ----------
// The logo code is gone, so nothing spawns them again. This only cleans up what is still in the world.
function removeOldLogos() {
  try {
    for (const e of world.getDimension(DIMENSION).getEntities({ type: "jester:logo" })) {
      try {
        e.remove();
      } catch (err) {}
    }
  } catch (e) {}
}
system.runInterval(removeOldLogos, 100);

// Old logo light blocks (3 per side, at 70+2, 70+32, 70+62 above the floor)
const oldLogoLights = [];
function listOldLogoLights() {
  const a = getActiveArena();
  const d = ARENA_HALF - 4.5;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const h of [2, 32, 62]) {
      oldLogoLights.push({
        x: Math.floor(a.cx + 0.5 + dx * d),
        y: Math.floor(a.fy + 70 + h),
        z: Math.floor(a.cz + 0.5 + dz * d),
      });
    }
  }
}
system.runInterval(() => {
  if (oldLogoLights.length === 0) return;
  const dim = world.getDimension(DIMENSION);
  for (let i = oldLogoLights.length - 1; i >= 0; i--) {
    const p = oldLogoLights[i];
    try {
      const b = dim.getBlock(p);
      if (!b) continue; // chunk not loaded yet, try again later
      if (b.typeId === "minecraft:light_block") dim.runCommand(`setblock ${p.x} ${p.y} ${p.z} minecraft:air`);
      oldLogoLights.splice(i, 1);
    } catch (e) {}
  }
}, 100);
system.runTimeout(listOldLogoLights, 100);

// ---------- 2. no mobs, always day ----------
// Natural spawning is off (the animals and villagers the arena builder places stay).
// Any monster that is still around is removed. The sun is locked at noon with clear weather.
function applyArenaWorldRules() {
  const dim = world.getDimension(DIMENSION);
  try {
    world.gameRules.doMobSpawning = false;
  } catch (e) {}
  try {
    dim.runCommand("gamerule domobspawning false");
  } catch (e) {}
  try {
    world.gameRules.doDayLightCycle = false;
  } catch (e) {}
  try {
    dim.runCommand("gamerule dodaylightcycle false");
  } catch (e) {}
  try {
    world.gameRules.doWeatherCycle = false;
  } catch (e) {}
  try {
    dim.runCommand("gamerule doweathercycle false");
  } catch (e) {}
  try {
    dim.runCommand("time set noon");
  } catch (e) {}
  try {
    dim.runCommand("weather clear");
  } catch (e) {}
  try {
    dim.runCommand("kill @e[family=monster]");
  } catch (e) {} // errors when there is nothing to kill, that is fine
}
system.runTimeout(applyArenaWorldRules, 40);
system.runInterval(applyArenaWorldRules, 200); // re-apply every 10 seconds

// ---------- 3. bright everywhere (also under the sky islands, in castles and in the forest) ----------
// Permanent Night Vision for everyone, with no particles and no flashing.
// It is topped up again after a death (a death removes all effects).
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const cur = player.getEffect("night_vision");
      if (cur && cur.duration > 4000) continue;
      player.addEffect("night_vision", 1000000, { amplifier: 0, showParticles: false });
    } catch (e) {}
  }
}, 40);

// =====================================================================
// SKY REALM  (paste at the VERY END of main.js, no import needed)
//
// Builds a magical sky above the dragon: ~20 floating islands (cherry trees, ponds,
// crystal spires, wizard towers, pavilions, portal rings, standing stones), two big
// centerpiece islands (a World Tree + crystal citadel in the south, a Moon Garden in the
// north), glowing bridges, clouds, and live sky effects (sparkles, magic, shooting stars).
//
//   !sky                 /scriptevent jester:sky              build the whole sky
//   !sky only 2 5        rebuild only those sections (1-9, same map as !arena)
//   !sky seed 5          different layout
//
// Run it AFTER !arena. It builds between 150 and 300 blocks above the arena floor (the dragon
// tops out at about 134) and keeps a gap around the big title wall (TITLE_MODE "blocks").
// Re-running it clears the old sky first. It never touches the arena below or the mountains.
// =====================================================================
const SKY_SEED = 2026;
const SKY_BASE = 150; // nothing is built below this height above the floor
const SKY_TOP = 300; // ...or above this one
const SKY_TITLE_GAP = 9; // blocks kept free on each side of the title wall (z = arena center)
const SKY_PARK_HEIGHT = 310; // where the builder parks you while it works (above everything)
const SKY_ALIVE = true; // sparkles, magic and shooting stars near players. false = off
const SKY_POINTS_KEY = "jester_sky_points";

let skyPointsCache = null;
function getSkyPoints() {
  if (skyPointsCache) return skyPointsCache;
  try {
    const raw = world.getDynamicProperty(SKY_POINTS_KEY);
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        skyPointsCache = v;
        return v;
      }
    }
  } catch (e) {}
  skyPointsCache = [];
  return skyPointsCache;
}
function setSkyPoints(points) {
  skyPointsCache = points;
  try {
    world.setDynamicProperty(SKY_POINTS_KEY, JSON.stringify(points));
  } catch (e) {}
}

// Pure function (no game calls): returns the same shape as generateArena / generateMountain
function generateSky(cx, cz, fy, seed) {
  const N = ARENA_SIZE;
  const S = ARENA_SECTION;
  const per = N / S;
  const X0 = cx - ARENA_HALF;
  const X1 = cx + ARENA_HALF - 1;
  const Z0 = cz - ARENA_HALF;
  const Z1 = cz + ARENA_HALF - 1;

  const rnd = makeRng(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p) => rnd() < p;
  const AIR = "minecraft:air";
  const pts = []; // spots where the sky effects sparkle

  // ---------- sections + command emitters (same layout as the arena) ----------
  const sections = [];
  for (let sz = 0; sz < per; sz++) {
    for (let sx = 0; sx < per; sx++) {
      sections.push({
        x0: X0 + sx * S,
        x1: X0 + (sx + 1) * S - 1,
        z0: Z0 + sz * S,
        z1: Z0 + (sz + 1) * S - 1,
        ops: [],
      });
    }
  }
  let totalCost = 0;
  const addOp = (sec, cmd, cost) => {
    sec.ops.push([cmd, cost]);
    totalCost += cost;
  };
  const set = (x, y, z, block, mode = "") => {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
    const sec = sections[Math.floor((z - Z0) / S) * per + Math.floor((x - X0) / S)];
    addOp(sec, `setblock ${x} ${y} ${z} ${block}${mode ? " " + mode : ""}`, 1);
  };
  const fill = (x1, y1, z1, x2, y2, z2, block, mode = "") => {
    const ax = Math.max(Math.min(x1, x2), X0);
    const bx = Math.min(Math.max(x1, x2), X1);
    const az = Math.max(Math.min(z1, z2), Z0);
    const bz = Math.min(Math.max(z1, z2), Z1);
    const ay = Math.min(y1, y2);
    const by = Math.max(y1, y2);
    if (ax > bx || az > bz) return;
    const sx0 = Math.floor((ax - X0) / S);
    const sx1 = Math.floor((bx - X0) / S);
    const sz0 = Math.floor((az - Z0) / S);
    const sz1 = Math.floor((bz - Z0) / S);
    for (let sz = sz0; sz <= sz1; sz++) {
      for (let sx = sx0; sx <= sx1; sx++) {
        const px0 = Math.max(ax, X0 + sx * S);
        const px1 = Math.min(bx, X0 + (sx + 1) * S - 1);
        const pz0 = Math.max(az, Z0 + sz * S);
        const pz1 = Math.min(bz, Z0 + (sz + 1) * S - 1);
        const area = (px1 - px0 + 1) * (pz1 - pz0 + 1);
        const step = Math.max(1, Math.floor(32000 / area));
        for (let y = ay; y <= by; y += step) {
          const ye = Math.min(by, y + step - 1);
          const vol = area * (ye - y + 1);
          addOp(
            sections[sz * per + sx],
            `fill ${px0} ${y} ${pz0} ${px1} ${ye} ${pz1} ${block}${mode ? " " + mode : ""}`,
            1 + Math.floor(vol / 3000)
          );
        }
      }
    }
  };

  const LEAF = (kind) => `minecraft:${kind}_leaves ["persistent_bit"=true]`;

  // Flat disc (one layer). blockFn is called once per row, so rows can differ.
  const disc = (x, z, r, y, blockFn, jitter = 0) => {
    r = Math.round(r);
    if (r < 0) return;
    for (let dz = -r; dz <= r; dz++) {
      let w = Math.floor(Math.sqrt(r * r - dz * dz) + 0.3);
      if (jitter && w > 1) w = Math.max(0, w + rint(-jitter, jitter));
      fill(x - w, y, z + dz, x + w, y, z + dz, blockFn());
    }
  };
  // Ellipsoid
  const ball = (x, cy, z, rx, ry, rz, blockFn, mode = "") => {
    const Y = Math.floor(ry);
    const Z = Math.floor(rz);
    for (let dy = -Y; dy <= Y; dy++) {
      for (let dz = -Z; dz <= Z; dz++) {
        const t = 1 - (ry ? (dy / ry) ** 2 : 0) - (rz ? (dz / rz) ** 2 : 0);
        if (t < 0) continue;
        const w = Math.floor(rx * Math.sqrt(t) + 0.3);
        fill(x - w, cy + dy, z + dz, x + w, cy + dy, z + dz, blockFn(), mode);
      }
    }
  };
  // Thick line of blocks (a, b = [x, y, z])
  const line = (a, b, t, block) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.5) + 1;
    for (let q = 0; q <= n; q++) {
      const f = q / n;
      const px = Math.round(a[0] + (b[0] - a[0]) * f);
      const py = Math.round(a[1] + (b[1] - a[1]) * f);
      const pz = Math.round(a[2] + (b[2] - a[2]) * f);
      fill(px, py, pz, px + t - 1, py + t - 1, pz + t - 1, block);
    }
  };
  // Horizontal ring of blocks
  const ringH = (x, z, y, R, block, lampEvery) => {
    const seen = new Set();
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      const bx = Math.round(x + Math.cos(rad) * R);
      const bz = Math.round(z + Math.sin(rad) * R);
      const key = bx + "," + bz;
      if (seen.has(key)) continue;
      seen.add(key);
      set(bx, y, bz, lampEvery && a % lampEvery === 0 ? "minecraft:sea_lantern" : block);
    }
  };
  // Vertical halo ring (in the x-y plane), 2 blocks thick
  const haloV = (x, z, cy, R) => {
    const seen = new Set();
    for (let a = 0; a < 360; a += 3) {
      const rad = (a * Math.PI) / 180;
      for (const rr of [R - 1, R]) {
        const bx = Math.round(x + Math.cos(rad) * rr);
        const by = Math.round(cy + Math.sin(rad) * rr);
        const key = bx + "," + by + "," + rr;
        if (seen.has(key)) continue;
        seen.add(key);
        const b =
          rr === R && a % 30 === 0
            ? "minecraft:sea_lantern"
            : rr === R - 1 && a % 30 === 15
              ? "minecraft:crying_obsidian"
              : pick(["minecraft:end_stone_bricks", "minecraft:end_stone_bricks", "minecraft:purpur_block"]);
        fill(bx, by, z, bx, by, z + 1, b);
      }
    }
  };

  const SKY_PLANTS = [
    "minecraft:short_grass", "minecraft:short_grass", "minecraft:short_grass", "minecraft:fern",
    "minecraft:poppy", "minecraft:dandelion", "minecraft:cornflower", "minecraft:azure_bluet",
    "minecraft:allium", "minecraft:pink_tulip", "minecraft:oxeye_daisy",
  ];
  const skyMat = (k, depth) => {
    if (k === 0) return "minecraft:grass_block";
    if (k <= 2) return "minecraft:dirt";
    if (k > depth * 0.5 && chance(0.1)) return "minecraft:amethyst_block";
    if (chance(k / (depth + 2))) {
      return pick(["minecraft:deepslate", "minecraft:tuff", "minecraft:cobbled_deepslate", "minecraft:deepslate"]);
    }
    return pick(["minecraft:stone", "minecraft:stone", "minecraft:andesite", "minecraft:tuff", "minecraft:calcite"]);
  };

  // ---------- trees ----------
  const skyTree = (x, z, gy, kind) => {
    const k = kind ?? pick(["cherry", "cherry", "cherry", "oak", "birch"]);
    const h = rint(5, 8);
    const top = gy + h;
    const log = k === "cherry" ? "minecraft:cherry_log" : k === "oak" ? "minecraft:oak_log" : "minecraft:birch_log";
    fill(x, gy + 1, z, x, top, z, log);
    ball(x, top, z, k === "cherry" ? 4 : 3, 2, k === "cherry" ? 4 : 3, () => LEAF(k), "keep");
    ball(x, top + 2, z, 2, 1, 2, () => LEAF(k), "keep");
  };

  const scatter = (isl, minD, maxD, density) => {
    const n = Math.floor(isl.r * isl.r * density);
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = minD + Math.sqrt(rnd()) * Math.max(0, maxD - minD);
      set(Math.round(isl.x + Math.cos(ang) * d), isl.top + 1, Math.round(isl.z + Math.sin(ang) * d), pick(SKY_PLANTS), "keep");
    }
  };
  const ringTrees = (isl, minD, maxD, count, kind) => {
    for (let i = 0; i < count; i++) {
      const ang = rnd() * Math.PI * 2;
      const d = minD + rnd() * Math.max(0, maxD - minD);
      skyTree(Math.round(isl.x + Math.cos(ang) * d), Math.round(isl.z + Math.sin(ang) * d), isl.top, kind);
    }
  };

  // ---------- magic structures (gy = the grass layer of the island) ----------
  const spire = (x, z, gy, h, R) => {
    fill(x - R - 1, gy, z - R - 1, x + R + 1, gy, z + R + 1, "minecraft:polished_deepslate");
    for (let y = 0; y < h; y++) {
      const rr = Math.max(0, Math.round(R * (1 - y / h)));
      const b = y % 7 === 6 ? "minecraft:sea_lantern" : pick(["minecraft:amethyst_block", "minecraft:amethyst_block", "minecraft:purpur_block"]);
      fill(x - rr, gy + 1 + y, z - rr, x + rr, gy + 1 + y, z + rr, b);
    }
    fill(x, gy + 1 + h, z, x, gy + 4 + h, z, "minecraft:end_rod");
    set(x, gy + 5 + h, z, "minecraft:sea_lantern");
    for (const [ox, oz, oy] of [[R + 5, 0, 0.5], [-(R + 5), 0, 0.62], [0, R + 5, 0.4], [0, -(R + 5), 0.72]]) {
      const gx = x + ox;
      const gz = z + oz;
      const gyy = gy + 1 + Math.round(h * oy);
      fill(gx, gyy, gz, gx + 1, gyy + 1, gz + 1, "minecraft:amethyst_block");
      set(gx, gyy, gz, "minecraft:sea_lantern");
    }
    pts.push([x, gy + h, z]);
  };

  const wizardTower = (x, z, gy) => {
    disc(x, z, 4, gy, () => "minecraft:purpur_block");
    for (let y = 1; y <= 16; y++) {
      disc(x, z, 4, gy + y, () => (y % 5 === 0 ? "minecraft:purpur_block" : pick(["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cracked_stone_bricks"])));
      disc(x, z, 3, gy + y, () => AIR);
    }
    fill(x, gy + 1, z + 3, x, gy + 3, z + 4, AIR); // door
    for (const wy of [6, 11]) {
      set(x + 4, gy + wy, z, AIR);
      set(x - 4, gy + wy, z, AIR);
      set(x, gy + wy, z - 4, AIR);
    }
    for (let k = 0; k < 6; k++) disc(x, z, 5 - k, gy + 17 + k, () => "minecraft:dark_prismarine");
    fill(x, gy + 23, z, x, gy + 26, z, "minecraft:end_rod");
    set(x, gy + 1, z, "minecraft:enchanting_table");
    set(x - 2, gy + 1, z - 2, "minecraft:bookshelf");
    set(x - 2, gy + 2, z - 2, "minecraft:lantern");
    set(x + 2, gy + 1, z - 2, "minecraft:bookshelf");
    set(x + 2, gy + 1, z + 2, "minecraft:lectern");
    pts.push([x, gy + 22, z]);
  };

  const pavilion = (x, z, gy) => {
    disc(x, z, 5, gy, () => pick(["minecraft:quartz_block", "minecraft:smooth_quartz"]));
    for (let k = 0; k < 6; k++) {
      const rad = (k / 6) * Math.PI * 2;
      const px = Math.round(x + Math.cos(rad) * 4);
      const pz = Math.round(z + Math.sin(rad) * 4);
      fill(px, gy + 1, pz, px, gy + 5, pz, "minecraft:quartz_pillar");
    }
    disc(x, z, 5, gy + 6, () => "minecraft:quartz_block");
    disc(x, z, 3, gy + 7, () => "minecraft:purpur_block");
    disc(x, z, 1, gy + 8, () => "minecraft:quartz_block");
    set(x, gy + 9, z, "minecraft:sea_lantern");
    set(x, gy + 5, z, "minecraft:sea_lantern");
    set(x, gy + 1, z, "minecraft:enchanting_table");
    for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) set(x + ox, gy + 1, z + oz, "minecraft:quartz_slab");
    pts.push([x, gy + 5, z]);
  };

  const portalGate = (x, z, gy) => {
    const cy = gy + 11;
    const seen = new Set();
    for (let a = 0; a < 360; a += 3) {
      const rad = (a * Math.PI) / 180;
      for (const R of [8, 9]) {
        const bx = Math.round(x + Math.cos(rad) * R);
        const by = Math.round(cy + Math.sin(rad) * R);
        const key = bx + "," + by;
        if (seen.has(key)) continue;
        seen.add(key);
        const b =
          R === 9 && a % 30 === 0
            ? "minecraft:sea_lantern"
            : R === 8 && a % 30 === 15
              ? "minecraft:crying_obsidian"
              : pick(["minecraft:end_stone_bricks", "minecraft:end_stone_bricks", "minecraft:purpur_block"]);
        fill(bx, by, z, bx, by, z + 1, b);
      }
    }
    fill(x - 2, gy + 1, z, x + 2, gy + 1, z + 1, "minecraft:end_stone_bricks");
    ball(x, cy, z, 2, 2, 2, () => "minecraft:amethyst_block");
    set(x, cy, z, "minecraft:sea_lantern");
    pts.push([x, cy, z]);
  };

  const standingStones = (x, z, gy, R) => {
    disc(x, z, 2, gy, () => "minecraft:polished_blackstone_bricks");
    for (let k = 0; k < 7; k++) {
      const rad = (k / 7) * Math.PI * 2;
      const px = Math.round(x + Math.cos(rad) * R);
      const pz = Math.round(z + Math.sin(rad) * R);
      const h = rint(4, 7);
      fill(px, gy + 1, pz, px, gy + h, pz, pick(["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:cobblestone"]));
      set(px, gy + h + 1, pz, k % 2 ? "minecraft:crying_obsidian" : "minecraft:soul_lantern");
    }
    set(x, gy + 1, z, "minecraft:crying_obsidian");
    fill(x, gy + 2, z, x, gy + 5, z, "minecraft:end_rod");
    pts.push([x, gy + 5, z]);
  };

  const gardenPond = (x, z, gy) => {
    disc(x, z, 2, gy, () => "minecraft:water");
    set(x, gy - 1, z, "minecraft:sea_lantern");
    for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
      fill(x + ox, gy + 1, z + oz, x + ox, gy + 3, z + oz, "minecraft:cobblestone_wall");
      set(x + ox, gy + 4, z + oz, "minecraft:lantern");
    }
    pts.push([x, gy + 2, z]);
  };

  // ---------- the two big centerpiece islands ----------
  const citadel = (isl) => {
    const { x, z, top: gy } = isl;
    disc(x, z, 12, gy, () => pick(["minecraft:polished_andesite", "minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:smooth_quartz"]));
    // the World Tree
    const tx = x - 13;
    fill(tx - 1, gy + 1, z - 1, tx + 1, gy + 33, z + 1, "minecraft:cherry_log");
    fill(tx - 2, gy + 1, z, tx + 2, gy + 3, z, "minecraft:cherry_log");
    fill(tx, gy + 1, z - 2, tx, gy + 3, z + 2, "minecraft:cherry_log");
    for (const [bx, bz] of [[10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, -8]]) {
      line([tx, gy + 22, z], [tx + bx, gy + 30, z + bz], 2, "minecraft:cherry_log");
    }
    ball(tx, gy + 33, z, 18, 8, 18, () => LEAF("cherry"), "keep");
    for (let i = 0; i < 70; i++) {
      const dx = rint(-16, 16);
      const dy = rint(-7, 7);
      const dz = rint(-16, 16);
      if ((dx / 18) ** 2 + (dy / 8) ** 2 + (dz / 18) ** 2 > 0.85) continue;
      set(tx + dx, gy + 33 + dy, z + dz, "minecraft:shroomlight"); // glowing fruit
    }
    // crystal spire with magic rings
    const sx = x + 13;
    spire(sx, z, gy, 46, 4);
    ringH(sx, z, gy + 28, 10, "minecraft:purpur_block", 30);
    ringH(sx, z, gy + 37, 14, "minecraft:purpur_block", 30);
    haloV(sx, z, gy + 32, 13);
    // obelisks
    for (const [ox, oz] of [[0, -11], [0, 11]]) {
      fill(x + ox, gy + 1, z + oz, x + ox, gy + 7, z + oz, "minecraft:polished_blackstone_bricks");
      set(x + ox, gy + 8, z + oz, "minecraft:sea_lantern");
    }
    scatter(isl, 21, 28, 0.25);
    ringTrees(isl, 22, 27, 6, "cherry");
    pts.push([tx, gy + 33, z], [tx + 6, gy + 28, z + 6], [x, gy + 3, z]);
  };

  const moonGarden = (isl) => {
    const { x, z, top: gy } = isl;
    disc(x, z, 11, gy, () => pick(["minecraft:smooth_quartz", "minecraft:quartz_block", "minecraft:polished_diorite"]));
    for (let k = 0; k < 8; k++) {
      const rad = (k / 8) * Math.PI * 2;
      const px = Math.round(x + Math.cos(rad) * 9);
      const pz = Math.round(z + Math.sin(rad) * 9);
      fill(px, gy + 1, pz, px, gy + 10, pz, "minecraft:quartz_pillar");
      set(px, gy + 11, pz, "minecraft:sea_lantern");
    }
    ringH(x, z, gy + 11, 9, "minecraft:quartz_block", 0);
    fill(x, gy + 1, z, x, gy + 12, z, "minecraft:end_rod");
    ball(x, gy + 19, z, 5, 6, 5, () => "minecraft:amethyst_block");
    ball(x, gy + 19, z, 2, 2, 2, () => "minecraft:sea_lantern");
    for (const [ox, oz] of [[9, 0], [-5, 8], [-5, -8]]) {
      fill(x + ox, gy + 17, z + oz, x + ox + 1, gy + 18, z + oz + 1, "minecraft:amethyst_block");
      set(x + ox, gy + 17, z + oz, "minecraft:sea_lantern");
    }
    haloV(x, z, gy + 19, 11);
    scatter(isl, 13, 20, 0.3);
    ringTrees(isl, 14, 20, 6, "cherry");
    pts.push([x, gy + 19, z], [x, gy + 3, z]);
  };

  // =====================================================================
  // 1. clear the old sky (never touches the title wall or anything below SKY_BASE)
  // =====================================================================
  fill(X0, fy + SKY_BASE - 4, Z0, X1, fy + SKY_TOP, cz - SKY_TITLE_GAP, AIR);
  fill(X0, fy + SKY_BASE - 4, cz + SKY_TITLE_GAP, X1, fy + SKY_TOP, Z1, AIR);

  // =====================================================================
  // 2. place the islands
  // =====================================================================
  const FOOT = { spire: 7, tower: 6, pavilion: 7, gate: 11, stones: 10, garden: 0 };
  const islands = [
    { x: cx + 5, z: cz + 78, top: fy + 205, r: 34, kind: "citadel" },
    { x: cx - 10, z: cz - 72, top: fy + 195, r: 26, kind: "moon" },
  ];
  for (let tries = 0; tries < 500 && islands.length < 20; tries++) {
    const r = rint(7, 16);
    const x = cx + rint(-ARENA_HALF + r + 14, ARENA_HALF - r - 14);
    const z = cz + rint(-ARENA_HALF + r + 14, ARENA_HALF - r - 14);
    const top = fy + rint(176, 250);
    if (Math.abs(z - cz) < SKY_TITLE_GAP + r) continue;
    if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 12 && Math.abs(o.top - top) < 48)) continue;
    const kind = r <= 9 ? pick(["spire", "tower", "garden", "spire"]) : r <= 12 ? pick(["pavilion", "tower", "spire", "garden", "pavilion"]) : pick(["gate", "stones", "pavilion", "tower", "spire", "gate"]);
    islands.push({ x, z, top, r, kind });
  }

  for (const isl of islands) {
    const { x, z, top, r, kind } = isl;
    const depth = Math.min(26, Math.floor(r * 1.4));

    // rock body: grass on top, tapering to a point underneath
    for (let k = 0; k <= depth; k++) {
      const f = 1 - k / (depth + 1);
      const wob = 0.86 + 0.28 * valueNoise(x / 6 + k * 0.9, z / 6 - k * 0.4, seed + 301);
      const rk = Math.max(1, Math.round(r * Math.pow(f, 0.7) * wob));
      disc(x, z, rk, top - k, () => skyMat(k, depth), k < depth - 3 ? 1 : 0);
    }
    // glowing crystals hanging underneath
    for (let n = rint(2, 4); n > 0; n--) {
      const bx = x + rint(-1, 1);
      const bz = z + rint(-1, 1);
      const len = rint(2, 4);
      fill(bx, top - depth - len, bz, bx, top - depth - 1, bz, "minecraft:amethyst_block");
      set(bx, top - depth - len - 1, bz, "minecraft:sea_lantern");
    }
    pts.push([x + rint(-2, 2), top - depth - 3, z + rint(-2, 2)]);

    if (kind === "citadel") {
      citadel(isl);
      continue;
    }
    if (kind === "moon") {
      moonGarden(isl);
      continue;
    }

    const foot = FOOT[kind] ?? 0;
    scatter(isl, foot + 1, r * 0.78, 0.7);
    ringTrees(isl, foot + 3, Math.max(foot + 3, r * 0.72), Math.max(1, Math.floor(r / 4)), undefined);
    if (kind === "spire") spire(x, z, top, rint(18, 28), 2);
    else if (kind === "tower") wizardTower(x, z, top);
    else if (kind === "pavilion") pavilion(x, z, top);
    else if (kind === "gate") portalGate(x, z, top);
    else if (kind === "stones") standingStones(x, z, top, Math.min(8, r - 3));
    else gardenPond(x, z, top);
  }

  // =====================================================================
  // 3. glowing bridges between neighbouring islands (never across the title wall)
  // =====================================================================
  const linked = new Set();
  const bridges = [];
  for (let i = 0; i < islands.length; i++) {
    let best = -1;
    let bd = 1e9;
    for (let j = 0; j < islands.length; j++) {
      if (i === j) continue;
      const A = islands[i];
      const B = islands[j];
      if ((A.z - cz) * (B.z - cz) < 0) continue;
      const d = Math.hypot(A.x - B.x, A.z - B.z) - A.r - B.r;
      if (d < 4 || d > 70 || Math.abs(A.top - B.top) > 30) continue;
      if (linked.has(Math.min(i, j) + "-" + Math.max(i, j))) continue;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (best >= 0) {
      linked.add(Math.min(i, best) + "-" + Math.max(i, best));
      bridges.push([islands[i], islands[best]]);
    }
  }
  for (const [A, B] of bridges) {
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    const ux = (B.x - A.x) / d;
    const uz = (B.z - A.z) / d;
    const sx = A.x + ux * A.r * 0.8;
    const sz = A.z + uz * A.r * 0.8;
    const ex = B.x - ux * B.r * 0.8;
    const ez = B.z - uz * B.r * 0.8;
    const len = Math.hypot(ex - sx, ez - sz);
    const steps = Math.ceil(Math.max(len, Math.abs(B.top - A.top)) * 1.2);
    const px = -uz;
    const pz = ux;
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = Math.round(A.top + (B.top - A.top) * t);
      for (const w of [-1, 0, 1]) {
        const bx = Math.round(sx + (ex - sx) * t + px * w);
        const bz = Math.round(sz + (ez - sz) * t + pz * w);
        const key = bx + "," + y + "," + bz;
        if (seen.has(key)) continue;
        seen.add(key);
        set(bx, y, bz, w === 0 ? "minecraft:smooth_stone" : pick(["minecraft:stone_bricks", "minecraft:mossy_stone_bricks", "minecraft:polished_andesite"]));
        if (w !== 0 && i % 6 === 3) set(bx, y + 1, bz, "minecraft:lantern");
      }
    }
  }

  // =====================================================================
  // 4. clouds (a few, so the arena below stays bright)
  // =====================================================================
  for (let n = 0; n < 45; n++) {
    const x = cx + rint(-140, 140);
    const z = cz + rint(-140, 140);
    const y = fy + rint(158, 285);
    const rx = rint(8, 18);
    const rz = rint(5, 10);
    const ry = rint(2, 3);
    if (Math.abs(z - cz) < SKY_TITLE_GAP + rz + 4) continue;
    if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + rx + 8 && Math.abs(o.top - y) < 40)) continue;
    const cloud = () => (chance(0.85) ? "minecraft:white_concrete" : "minecraft:light_gray_concrete");
    ball(x, y, z, rx, ry, rz, cloud);
    ball(x + Math.floor(rx / 2), y + 1, z, Math.floor(rx * 0.6), ry + 1, Math.floor(rz * 0.7), cloud);
  }

  return { sections, totalCost, X0, X1, Z0, Z1, points: pts.slice(0, 150), islands: islands.length };
}

// ---------- command + builder ----------
function buildSky(player, opts) {
  if (arenaBusy) {
    player.sendMessage("§cThe arena (or mountain or sky) is already being built.");
    return;
  }
  arenaBusy = true;
  try {
    const dim = world.getDimension(DIMENSION);
    const a = getArenaByIndex(opts.arenaIndex ?? 0); // !sky arena 2 = the sky of the copy
    const gen = generateSky(a.cx, a.cz, a.fy, opts.seed);
    if (a.index === 0) setSkyPoints(gen.points); // copies reuse these points, shifted (see the live sky loop)
    const minutes = Math.max(1, Math.round(gen.totalCost / ARENA_BUDGET / 20 / 60));
    const which = opts.only ? `sections ${opts.only.join(", ")} only` : `all ${gen.sections.length} sections`;
    player.sendMessage(
      `§eBuilding the sky realm (${gen.islands} floating islands) above the arena at ${a.cx}, ${a.cz} (seed ${opts.seed}), ${which}. ` +
        `Takes about ${minutes}+ minute(s). You will be moved around, high up. Stay in the world.`
    );
    runArenaSections(player, dim, gen, a.fy, { only: opts.only, parkY: SKY_PARK_HEIGHT, label: "Sky", cmd: "sky" });
  } catch (e) {
    arenaBusy = false;
    player.sendMessage("§cSky failed to start: " + e);
    console.warn("[sky] failed to start: " + e);
  }
}

function runSkyCommand(player, message) {
  if (!player || player.typeId !== "minecraft:player") return;
  if (!canUseArenaCommands(player)) {
    player.sendMessage("§cYou need the tag \"" + ARENA_ADMIN_TAG + "\" to use this command.");
    return;
  }
  const words = (message || "").trim().toLowerCase().split(/\s+/);
  const opts = { seed: SKY_SEED, only: parseOnly(words, 9), arenaIndex: parseArenaNumber(words) };
  const si = words.indexOf("seed");
  if (si >= 0 && words[si + 1] !== undefined && Number.isFinite(Number(words[si + 1]))) opts.seed = Number(words[si + 1]);
  buildSky(player, opts);
}

try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = (ev.message || "").trim();
    if (!/^!sky(\s|$)/i.test(msg)) return;
    ev.cancel = true;
    const player = ev.sender;
    system.run(() => runSkyCommand(player, msg.slice(4)));
  });
} catch (e) {
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "jester:sky") return;
  let player = ev.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") player = world.getAllPlayers()[0];
  if (!player) return;
  system.runTimeout(() => {
    try {
      runSkyCommand(player, ev.message);
    } catch (e) {
      arenaBusy = false;
      console.warn("[sky] jester:sky failed: " + e);
    }
  }, 2);
});

// =====================================================================
// LIVE SKY: drifting sparkles, magic around the structures, shooting stars.
// Only runs near players (cheap). Set SKY_ALIVE = false to turn it off.
// =====================================================================
let skyBeat = 0;

function skyShootingStar(dim, player) {
  const l = player.location;
  const ang = Math.random() * Math.PI * 2;
  let x = l.x + Math.cos(ang) * 45;
  let y = l.y + 45 + Math.random() * 30;
  let z = l.z + Math.sin(ang) * 45;
  let dx = (Math.random() - 0.5) * 2;
  let dz = (Math.random() - 0.5) * 2;
  const dy = -0.45;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx = (dx / len) * 2.2;
  dz = (dz / len) * 2.2;
  const vy = (dy / len) * 2.2;
  let n = 0;
  const id = system.runInterval(() => {
    try {
      dim.spawnParticle("minecraft:endrod", { x, y, z });
      dim.spawnParticle("minecraft:totem_particle", { x: x - dx * 0.5, y: y - vy * 0.5, z: z - dz * 0.5 });
    } catch (e) {}
    x += dx;
    y += vy;
    z += dz;
    if (++n > 28) system.clearRun(id);
  }, 1);
}

system.runInterval(() => {
  if (!SKY_ALIVE || arenaBusy) return;
  skyBeat++;
  const dim = world.getDimension(DIMENSION);
  const arenas = getArenaList();
  const a0 = arenas[0];
  const pts0 = getSkyPoints();
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== dim.id) continue;
      const l = p.location;
      // which arena is the player in (the first one or a copy)?
      const a = arenas.find((ar) => Math.abs(l.x - ar.cx) <= ARENA_HALF + 20 && Math.abs(l.z - ar.cz) <= ARENA_HALF + 20);
      if (!a) continue;
      const offX = a.cx - a0.cx;
      const offZ = a.cz - a0.cz;
      const pts = pts0.map((q) => [q[0] + offX, q[1], q[2] + offZ]);

      // drifting sparkles in the sky band around the player
      for (let i = 0; i < 8; i++) {
        dim.spawnParticle("minecraft:endrod", {
          x: l.x + (Math.random() - 0.5) * 80,
          y: a.fy + SKY_BASE + Math.random() * (SKY_TOP - SKY_BASE - 20),
          z: l.z + (Math.random() - 0.5) * 80,
        });
      }

      // magic around nearby structures
      let shown = 0;
      for (const q of pts) {
        if (shown >= 12) break;
        const ddx = q[0] - l.x;
        const ddz = q[2] - l.z;
        if (ddx * ddx + ddz * ddz > 70 * 70) continue;
        shown++;
        dim.spawnParticle(skyBeat % 2 ? "minecraft:totem_particle" : "minecraft:endrod", {
          x: q[0] + (Math.random() - 0.5) * 4,
          y: q[1] + Math.random() * 4,
          z: q[2] + (Math.random() - 0.5) * 4,
        });
      }

      // now and then a shooting star
      if (skyBeat % 12 === 0 && Math.random() < 0.5) skyShootingStar(dim, p);
    } catch (e) {}
  }
}, 10);

// =====================================================================
// MATCH SYSTEM (paste at the VERY END of main.js, no import needed)
//
//  - Several arenas: the first one + copies built with  !arena copy  (same layout, another place).
//    Each arena holds at most MAX_PER_ROLE (10) players per role. A new player goes to the first arena
//    that still has a free slot for the role they picked.
//  - Same role = teammates (no damage between them). Different roles fight.
//  - Right side of the screen (scoreboard): players left for each role + kills. Action bar: your own kills.
//  - Win: last role standing (or last player standing). Winners get a gold title + a loud cheer and are
//    teleported back to the spawn together with everyone else of that match.
//  - Dead players spectate the match (1st person or 3rd person only) with 4 hotbar items.
//
//  Chat / command:  !arenas  (/scriptevent jester:arenas go)   shows every arena and its player counts
//                   !arena copy   builds the next arena (copy of arena 1)
//                   !mountain arena 2    !sky arena 2    mountain ring / sky of arena 2
// =====================================================================
const MAX_PER_ROLE = 10;
const ARENA_SPACING = 520; // blocks between the centers of two arenas (x direction)
const ARENA_COPIES_KEY = "jester_arena_copies";
const ARENA_SEED_KEY = "jester_arena_seed";
const MATCH_TAG_PREFIX = "cnmp_arena_"; // + arena index, set while a player is in a match
const SPEC_TAG = "cnmp_spectator"; // eliminated, watching the match
const KILLS_PROP = "cnmp_kills";
const SIDEBAR_ID = "cnmp_side";
const SPECTATE_DISTANCE = 4.5; // 3rd person camera distance

const stripColors = (s) => String(s).replace(/§./g, "");

// ---------- arena list: index 0 = the first arena, 1+ = copies ----------
let arenaCopiesCache = null;
function getArenaCopies() {
  if (arenaCopiesCache) return arenaCopiesCache;
  try {
    const raw = world.getDynamicProperty(ARENA_COPIES_KEY);
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        arenaCopiesCache = v.filter((c) => c && [c.cx, c.cz, c.fy].every(Number.isFinite));
        return arenaCopiesCache;
      }
    }
  } catch (e) {}
  arenaCopiesCache = [];
  return arenaCopiesCache;
}
function saveArenaCopies(list) {
  arenaCopiesCache = list;
  try {
    world.setDynamicProperty(ARENA_COPIES_KEY, JSON.stringify(list));
  } catch (e) {}
}
function getArenaList() {
  const a0 = getActiveArena();
  return [
    { index: 0, cx: a0.cx, cz: a0.cz, fy: a0.fy },
    ...getArenaCopies().map((c, i) => ({ index: i + 1, cx: c.cx, cz: c.cz, fy: c.fy })),
  ];
}
function getArenaByIndex(n) {
  const list = getArenaList();
  return list[n] ?? list[0];
}

// ---------- who is where ----------
function arenaIndexOf(player) {
  try {
    for (const t of player.getTags()) {
      if (t.startsWith(MATCH_TAG_PREFIX)) {
        const n = Number(t.slice(MATCH_TAG_PREFIX.length));
        if (Number.isInteger(n) && n >= 0) return n;
      }
    }
  } catch (e) {}
  return -1;
}
function membersOf(n) {
  return world.getAllPlayers().filter((p) => arenaIndexOf(p) === n);
}
function aliveIn(n) {
  return membersOf(n).filter((p) => !p.hasTag(SPEC_TAG) && roleCfgOf(p));
}
function clearMatchTags(player) {
  try {
    for (const t of player.getTags()) {
      if (t.startsWith(MATCH_TAG_PREFIX) || t === SPEC_TAG) player.removeTag(t);
    }
  } catch (e) {}
  deadInfo.delete(player.id);
}

const arenaStates = new Map(); // arena index -> { active, ending }
function getArenaState(n) {
  let s = arenaStates.get(n);
  if (!s) {
    s = { active: false, ending: false };
    arenaStates.set(n, s);
  }
  return s;
}

function getKills(player) {
  try {
    const v = player.getDynamicProperty(KILLS_PROP);
    return typeof v === "number" ? v : 0;
  } catch (e) {
    return 0;
  }
}
function setKills(player, n) {
  try {
    player.setDynamicProperty(KILLS_PROP, n);
  } catch (e) {}
}

// Same arena + same role = teammates
function sameTeam(a, b) {
  try {
    if (!a || !b || a.id === b.id) return false;
    if (a.typeId !== "minecraft:player" || b.typeId !== "minecraft:player") return false;
    const na = arenaIndexOf(a);
    if (na < 0 || na !== arenaIndexOf(b)) return false;
    const ra = roleCfgOf(a);
    const rb = roleCfgOf(b);
    return !!ra && !!rb && ra.tag === rb.tag;
  } catch (e) {
    return false;
  }
}

// ---------- joining: max 10 per role per arena, overflow goes to the next arena ----------
function pickArenaFor(player, cfg) {
  for (const a of getArenaList()) {
    if (getArenaState(a.index).ending) continue;
    const taken = aliveIn(a.index).filter((p) => p.id !== player.id && roleCfgOf(p)?.tag === cfg.tag).length;
    if (taken < MAX_PER_ROLE) return a.index;
  }
  return -1;
}

function joinRole(player, cfg) {
  // a click can fire twice: ignore it when they already joined with this role
  if (roleCfgOf(player)?.tag === cfg.tag && arenaIndexOf(player) >= 0 && !player.hasTag(SPEC_TAG)) return;

  const n = pickArenaFor(player, cfg);
  if (n < 0) {
    const copies = getArenaCopies().length + 1;
    player.sendMessage(
      `§c${cfg.label}§r§c is full in all ${copies} arena(s) (${MAX_PER_ROLE} players each). ` +
        `Pick another role, or wait. An admin can add another arena with §f!arena copy§c.`
    );
    try {
      player.onScreenDisplay.setActionBar("§cThat role is full in every arena!");
      player.playSound("note.bass");
    } catch (e) {}
    return;
  }

  clearMatchTags(player);
  stopSpectating(player);
  player.addTag(MATCH_TAG_PREFIX + n);
  setKills(player, 0);
  acceptRole(player, cfg);
  goToArena(player, cfg, n);

  const count = aliveIn(n).filter((p) => roleCfgOf(p)?.tag === cfg.tag).length;
  player.sendMessage(
    `§aYou joined §fArena ${n + 1}§a as ${cfg.label}§r§a (${count}/${MAX_PER_ROLE} on your team). ` +
      `§7Players with the same role are your teammates, you cannot hurt each other.`
  );
  system.run(() => checkArena(n));
}

// ---------- no friendly fire ----------
let friendlyFireMode = "none";
try {
  if (world.beforeEvents.entityHurt) {
    world.beforeEvents.entityHurt.subscribe((ev) => {
      try {
        const attacker = ev.damageSource?.damagingEntity;
        if (attacker && sameTeam(attacker, ev.hurtEntity)) ev.cancel = true;
      } catch (e) {}
    });
    friendlyFireMode = "cancel";
  }
} catch (e) {
  console.warn("[match] beforeEvents.entityHurt is not available: " + e);
}
if (friendlyFireMode === "none") {
  // Older API: the hit already happened, so give the health back (cannot save a hit that kills)
  world.afterEvents.entityHurt.subscribe((ev) => {
    try {
      const attacker = ev.damageSource?.damagingEntity;
      if (!attacker || !sameTeam(attacker, ev.hurtEntity)) return;
      const hp = ev.hurtEntity.getComponent("minecraft:health");
      if (hp && hp.currentValue > 0) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + ev.damage));
    } catch (e) {}
  });
  friendlyFireMode = "heal";
}

// ---------- kills + eliminations ----------
const deadInfo = new Map(); // dead player id -> { killerId }

function handleMatchDeath(event) {
  const dead = event.deadEntity;
  const n = arenaIndexOf(dead);
  const cfg = roleCfgOf(dead);
  if (n < 0 || !cfg || dead.hasTag(SPEC_TAG)) return; // not in a match
  const st = getArenaState(n);

  // the match counts as running once two different roles were alive together
  const rolesBefore = new Set(aliveIn(n).map((p) => roleCfgOf(p).tag));
  if (rolesBefore.size >= 2) st.active = true;

  const killer = event.damageSource?.damagingEntity;
  let killerId = null;
  let killerName = "";
  if (
    killer &&
    killer.typeId === "minecraft:player" &&
    killer.id !== dead.id &&
    arenaIndexOf(killer) === n &&
    !killer.hasTag(SPEC_TAG) &&
    !sameTeam(killer, dead)
  ) {
    const k = getKills(killer) + 1;
    setKills(killer, k);
    killerId = killer.id;
    killerName = killer.name;
    try {
      killer.onScreenDisplay.setActionBar(`§c⚔ You eliminated §f${dead.name}§c!  §7Kills: §f${k}`);
    } catch (e) {}
    killDopamine(killer, dead, k);
  }

  dead.addTag(SPEC_TAG); // out of the match
  deadInfo.set(dead.id, { killerId });

  const msg =
    `§c☠ §f${dead.name} §7(${cfg.label}§r§7) was eliminated` + (killerName ? ` §7by §f${killerName}` : "") + "§7.";
  for (const p of membersOf(n)) {
    try {
      p.sendMessage(msg);
    } catch (e) {}
  }
  system.run(() => checkArena(n));
}

// Satisfying kill sound: a quick rising "ding-ding-ding", higher with every kill, plus sparkles where the victim fell
function killDopamine(killer, dead, kills) {
  const up = Math.min(0.5, (kills - 1) * 0.06);
  const play = (id, pitch, volume = 1) => {
    try {
      killer.playSound(id, { volume, pitch });
    } catch (e) {}
  };
  play("random.orb", 1.2 + up);
  play("note.pling", 1.0 + up, 1.2);
  system.runTimeout(() => play("note.pling", 1.5 + up, 1.2), 3);
  system.runTimeout(() => play("note.pling", 2.0, 1.2), 6);
  system.runTimeout(() => play("random.levelup", 1.0 + up, 1), 6);
  if (kills >= 3) system.runTimeout(() => play("firework.twinkle", 1, 1), 9);
  if (kills >= 5) system.runTimeout(() => play("random.totem", 1.2, 0.8), 9);
  try {
    const l = dead.location;
    const dim = dead.dimension;
    for (let i = 0; i < 12; i++) {
      dim.spawnParticle("minecraft:totem_particle", {
        x: l.x + (Math.random() - 0.5) * 1.6,
        y: l.y + Math.random() * 2,
        z: l.z + (Math.random() - 0.5) * 1.6,
      });
    }
  } catch (e) {}
}

// ---------- winning ----------
function checkArena(n) {
  const st = getArenaState(n);
  if (st.ending) return;
  const alive = aliveIn(n);
  const roles = new Set(alive.map((p) => roleCfgOf(p).tag));
  if (!st.active) {
    if (roles.size >= 2) st.active = true;
    return;
  }
  if (roles.size >= 2) return;
  finishMatch(n, alive); // one role (or nobody) left
}
function checkAllArenas() {
  for (const a of getArenaList()) {
    try {
      checkArena(a.index);
    } catch (e) {
      console.warn("[match] check failed: " + e);
    }
  }
}
system.runInterval(checkAllArenas, 20);

function sendBackToLobby(player) {
  clearMatchTags(player);
  stopSpectating(player);
  resetPlayerForNewGame(player); // no role, no effects, no items
  forceSurvival(player);
  sendToSpawn(player);
}

const CHEER_SOUNDS = [
  ["random.toast", 1],
  ["random.totem", 1],
  ["raid.horn", 1.1],
  ["firework.large_blast", 1],
  ["firework.blast", 0.9],
  ["firework.twinkle", 1],
  ["random.levelup", 1.2],
];
function celebrate(player) {
  const play = () => {
    for (const [id, pitch] of CHEER_SOUNDS) {
      try {
        player.playSound(id, { volume: 4, pitch });
      } catch (e) {}
    }
  };
  play();
  system.runTimeout(play, 12);
  system.runTimeout(play, 30);
  let i = 0;
  const rid = system.runInterval(() => {
    try {
      const l = player.location;
      for (let k = 0; k < 6; k++) {
        player.dimension.spawnParticle("minecraft:totem_particle", {
          x: l.x + (Math.random() - 0.5) * 4,
          y: l.y + Math.random() * 3,
          z: l.z + (Math.random() - 0.5) * 4,
        });
      }
    } catch (e) {
      system.clearRun(rid);
      return;
    }
    if (++i > 16) system.clearRun(rid);
  }, 5);
}

function finishMatch(n, winners) {
  const st = getArenaState(n);
  st.ending = true;
  st.active = false;

  const members = membersOf(n);
  const winCfg = winners.length ? roleCfgOf(winners[0]) : null;
  let sub;
  if (!winCfg) sub = "Nobody survived";
  else if (winners.length === 1) sub = `${winners[0].name} is the last player standing!`;
  else sub = `Team ${stripColors(winCfg.label)} is the last role standing!`;
  const winIds = new Set(winners.map((p) => p.id));

  for (const p of members) {
    const won = winIds.has(p.id);
    const kills = getKills(p);
    sendBackToLobby(p); // everyone of this match goes back to the spawn
    system.runTimeout(() => {
      try {
        if (won) {
          p.onScreenDisplay.setTitle("§6§l★ VICTORY ★", {
            subtitle: `§e§l${sub}`,
            fadeInDuration: 5,
            stayDuration: 100,
            fadeOutDuration: 20,
          });
          p.onScreenDisplay.setActionBar(`§6You won with §f${kills} §6kill(s)!`);
          celebrate(p);
        } else {
          p.onScreenDisplay.setTitle("§c§lMATCH OVER", {
            subtitle: `§7${sub}`,
            fadeInDuration: 5,
            stayDuration: 70,
            fadeOutDuration: 15,
          });
          p.playSound("raid.horn", { volume: 1, pitch: 1 });
        }
      } catch (e) {}
    }, 10);
  }

  world.sendMessage(
    winCfg
      ? `§6§l🏆 Arena ${n + 1}: §e${sub} §6(${winCfg.label}§r§6)`
      : `§e§lArena ${n + 1}: ${sub}`
  );
  system.runTimeout(() => {
    st.ending = false;
  }, 100);
}

// ---------- spectating (1st / 3rd person only) ----------
const spectating = new Map(); // player id -> { target, third, arena, lastInput }
const SPEC_EASE = MC.EasingType ? { easeTime: 0.1, easeType: MC.EasingType.Linear } : undefined;

function beginSpectatingAfterDeath(player) {
  const n = arenaIndexOf(player);
  if (n < 0) return false;
  const st = getArenaState(n);
  if (st.ending || !st.active) return false;
  const alive = aliveIn(n);
  if (alive.length === 0) return false;

  const info = deadInfo.get(player.id);
  const target = alive.find((p) => p.id === info?.killerId) ?? alive[0]; // watch your killer first
  spectating.set(player.id, { target: target.id, third: true, arena: n, lastInput: 0 });

  try {
    player.setGameMode(GameMode.adventure);
  } catch (e) {}
  for (const [id, amp] of [["invisibility", 0], ["resistance", 4], ["fire_resistance", 0], ["water_breathing", 0]]) {
    try {
      player.addEffect(id, 1000000, { amplifier: amp, showParticles: false });
    } catch (e) {}
  }
  setMovementLocked(player, true);
  giveSpectatorItems(player);
  try {
    player.onScreenDisplay.setTitle("§c§lELIMINATED", {
      subtitle: "§7You are spectating. Use the items in your hotbar.",
      fadeInDuration: 5,
      stayDuration: 60,
      fadeOutDuration: 10,
    });
  } catch (e) {}
  return true;
}

function giveSpectatorItems(player) {
  try {
    const c = player.getComponent("inventory").container;
    const defs = [
      [0, "minecraft:red_dye", "§c« Previous player"],
      [1, "minecraft:lime_dye", "§aNext player »"],
      [2, "minecraft:ender_eye", "§b1st / 3rd person view"],
      [8, "minecraft:red_bed", "§eLeave to spawn"],
    ];
    for (const [slot, id, name] of defs) {
      const it = new ItemStack(id, 1);
      it.nameTag = name;
      try {
        it.lockMode = MC.ItemLockMode.Inventory;
      } catch (e) {}
      c.setItem(slot, it);
    }
  } catch (e) {
    console.warn("[match] spectator items failed: " + e);
  }
}

function stopSpectating(player) {
  const had = spectating.delete(player.id);
  try {
    player.camera.clear();
  } catch (e) {}
  if (!had) return;
  for (const id of ["invisibility", "resistance", "fire_resistance", "water_breathing"]) {
    try {
      player.removeEffect(id);
    } catch (e) {}
  }
  setMovementLocked(player, false);
}

function cycleTarget(s, dir) {
  const alive = aliveIn(s.arena);
  if (!alive.length) return null;
  let i = alive.findIndex((p) => p.id === s.target);
  i = i < 0 ? 0 : (i + dir + alive.length) % alive.length;
  s.target = alive[i].id;
  return alive[i];
}

world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  const s = p && spectating.get(p.id);
  if (!s) return;
  const now = system.currentTick;
  if (now - s.lastInput < 6) return;
  s.lastInput = now;
  try {
    switch (ev.itemStack?.typeId) {
      case "minecraft:lime_dye": {
        const t = cycleTarget(s, 1);
        if (t) p.onScreenDisplay.setActionBar(`§7Now watching §f${t.name}`);
        break;
      }
      case "minecraft:red_dye": {
        const t = cycleTarget(s, -1);
        if (t) p.onScreenDisplay.setActionBar(`§7Now watching §f${t.name}`);
        break;
      }
      case "minecraft:ender_eye":
        s.third = !s.third;
        p.onScreenDisplay.setActionBar(s.third ? "§b3rd person view" : "§b1st person view (their eyes)");
        break;
      case "minecraft:red_bed":
        sendBackToLobby(p);
        break;
    }
  } catch (e) {}
});

system.runInterval(() => {
  if (spectating.size === 0) return;
  const tick = system.currentTick;
  for (const [pid, s] of spectating) {
    const p = findPlayerById(pid);
    if (!p) {
      spectating.delete(pid);
      continue;
    }
    try {
      let t = findPlayerById(s.target);
      const valid = t && arenaIndexOf(t) === s.arena && !t.hasTag(SPEC_TAG) && roleCfgOf(t);
      if (!valid) {
        t = cycleTarget(s, 1);
        if (!t) continue; // nobody left: the match is ending
      }
      const head = t.getHeadLocation();
      const rot = t.getRotation(); // x = pitch, y = yaw
      const yaw = (rot.y * Math.PI) / 180;
      const pitch = (rot.x * Math.PI) / 180;
      const dx = -Math.sin(yaw) * Math.cos(pitch);
      const dy = -Math.sin(pitch);
      const dz = Math.cos(yaw) * Math.cos(pitch);
      const loc = s.third
        ? { x: head.x - dx * SPECTATE_DISTANCE, y: head.y - dy * SPECTATE_DISTANCE + 0.8, z: head.z - dz * SPECTATE_DISTANCE }
        : { x: head.x + dx * 0.3, y: head.y + dy * 0.3, z: head.z + dz * 0.3 };
      const opts = { location: loc, rotation: { x: rot.x, y: rot.y } };
      if (SPEC_EASE) opts.easeOptions = SPEC_EASE;
      p.camera.setCamera("minecraft:free", opts);

      // keep the (invisible, untouchable) body close to the action so the area stays loaded
      if (tick % 5 === 0) {
        const tl = t.location;
        p.teleport({ x: tl.x, y: tl.y + 4, z: tl.z }, { dimension: t.dimension });
      }
      if (tick % 10 === 0) {
        p.onScreenDisplay.setActionBar(
          `§7Spectating §f${t.name} §8| §e${s.third ? "3rd" : "1st"} person §8| §aAlive: §f${aliveIn(s.arena).length}`
        );
      }
    } catch (e) {}
  }
}, 1);

// ---------- right-side scoreboard + your own kill counter ----------
let sidebarShown = false;
function sbSet(obj, text, score) {
  try {
    if (obj.getScore(text) !== score) obj.setScore(text, score);
  } catch (e) {
    try {
      world.getDimension(DIMENSION).runCommand(`scoreboard players set "${text}" ${SIDEBAR_ID} ${score}`);
    } catch (e2) {}
  }
}

function refreshHud() {
  const sb = world.scoreboard;
  if (!sb) return;
  const players = world.getAllPlayers();
  const arenas = getArenaList();
  const multi = arenas.length > 1;
  const lines = new Map(); // text -> score
  const killRows = [];

  for (const a of arenas) {
    const mem = players.filter((p) => arenaIndexOf(p) === a.index);
    if (mem.length === 0) continue;
    const alive = mem.filter((p) => !p.hasTag(SPEC_TAG) && roleCfgOf(p));
    const tagA = multi ? `§7A${a.index + 1} ` : "";
    for (const cfg of STANDS) {
      lines.set(`${tagA}${cfg.label}§r §7left`, alive.filter((p) => roleCfgOf(p)?.tag === cfg.tag).length);
    }
    for (const p of mem) {
      killRows.push({ name: p.name, kills: getKills(p), arena: a.index });
    }
    // your own counter (bottom of the screen, above the hotbar)
    for (const p of alive) {
      if (spectating.has(p.id)) continue;
      try {
        const cfg = roleCfgOf(p);
        const mine = alive.filter((q) => roleCfgOf(q)?.tag === cfg.tag).length;
        const tm = typeof matchTimers !== "undefined" ? matchTimers.get(a.index) : null;
        const tl = tm ? (tm.final ? "§4§l⚔ FINAL BATTLE §r§8| " : "§c§l⏱ " + fmtTime(Math.max(0, Math.ceil((tm.end - system.currentTick) / 20))) + " §r§8| ") : "";
        p.onScreenDisplay.setActionBar(
          `${tl}§c⚔ Kills: §f${getKills(p)} §8| §aAlive: §f${alive.length} §8| ${cfg.label}§r §7left: §f${mine}`
        );
      } catch (e) {}
    }
  }

  let obj = sb.getObjective(SIDEBAR_ID);
  if (lines.size === 0) {
    if (sidebarShown) {
      try {
        sb.clearObjectiveAtDisplaySlot(MC.DisplaySlotId.Sidebar);
      } catch (e) {}
      if (obj) {
        try {
          for (const part of obj.getParticipants()) obj.removeParticipant(part);
        } catch (e) {}
      }
      sidebarShown = false;
    }
    return;
  }

  killRows.sort((x, y) => y.kills - x.kills || x.name.localeCompare(y.name));
  for (const r of killRows.slice(0, Math.max(0, Math.min(6, 15 - lines.size)))) {
    lines.set(`§e⚔ §f${r.name}${multi ? " §8A" + (r.arena + 1) : ""}`, r.kills);
  }

  if (!obj) obj = sb.addObjective(SIDEBAR_ID, "§6§lCNMB ARENA");
  try {
    for (const part of obj.getParticipants()) {
      if (!lines.has(part.displayName)) obj.removeParticipant(part);
    }
  } catch (e) {}
  for (const [text, score] of lines) sbSet(obj, text, score);

  if (!sidebarShown) {
    try {
      sb.setObjectiveAtDisplaySlot(MC.DisplaySlotId.Sidebar, { objective: obj, sortOrder: MC.ObjectiveSortOrder.Descending });
    } catch (e) {
      try {
        world.getDimension(DIMENSION).runCommand(`scoreboard objectives setdisplay sidebar ${SIDEBAR_ID} descending`);
      } catch (e2) {}
    }
    sidebarShown = true;
  }
}
system.runInterval(() => {
  try {
    refreshHud();
  } catch (e) {
    console.warn("[match] hud failed: " + e);
  }
}, 20);

// ---------- !arenas : who is where ----------
function showArenaStatus(player) {
  const out = [`§6§lArenas §7(max ${MAX_PER_ROLE} per role, a new player fills arena 1 first)`];
  for (const a of getArenaList()) {
    const st = getArenaState(a.index);
    const alive = aliveIn(a.index);
    const counts = STANDS.map((cfg) => `${cfg.label}§r §f${alive.filter((p) => roleCfgOf(p)?.tag === cfg.tag).length}/${MAX_PER_ROLE}`);
    out.push(
      `§eArena ${a.index + 1} §7(${a.cx}, ${a.cz}) ${st.active ? "§aRUNNING" : "§7waiting"}§7: ` + counts.join("§7  ")
    );
  }
  out.push("§7Add an arena: §f!arena copy");
  player.sendMessage(out.join("\n"));
}

// =====================================================================
// MOUNTAIN LIFE: sparks, flames and glints around the caves, statues, towers and camps.
// The points come from the mountain builder (!mountain or !mountain decor).
// Set MOUNTAIN_ALIVE = false to turn the particles off.
// =====================================================================
const MOUNTAIN_ALIVE = true;
const MOUNTAIN_POINTS_KEY = "jester_mountain_points";
let mountainPointsCache = null;
function getMountainPoints() {
  if (mountainPointsCache) return mountainPointsCache;
  try {
    const raw = world.getDynamicProperty(MOUNTAIN_POINTS_KEY);
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        mountainPointsCache = v;
        return v;
      }
    }
  } catch (e) {}
  mountainPointsCache = [];
  return mountainPointsCache;
}
function setMountainPoints(points) {
  mountainPointsCache = points;
  try {
    world.setDynamicProperty(MOUNTAIN_POINTS_KEY, JSON.stringify(points));
  } catch (e) {}
}

system.runInterval(() => {
  if (!MOUNTAIN_ALIVE || arenaBusy) return;
  const pts0 = getMountainPoints();
  if (pts0.length === 0) return;
  const arenas = getArenaList();
  const a0 = arenas[0];
  const dim = world.getDimension(DIMENSION);
  for (const p of world.getAllPlayers()) {
    try {
      if (p.dimension.id !== dim.id) continue;
      const l = p.location;
      const a = arenas.find((ar) => Math.abs(l.x - ar.cx) <= ARENA_HALF + MOUNTAIN_WIDTH && Math.abs(l.z - ar.cz) <= ARENA_HALF + MOUNTAIN_WIDTH);
      if (!a) continue;
      const offX = a.cx - a0.cx;
      const offZ = a.cz - a0.cz;
      let shown = 0;
      for (const q of pts0) {
        if (shown >= 16) break;
        const x = q[0] + offX;
        const z = q[2] + offZ;
        const ddx = x - l.x;
        const ddz = z - l.z;
        if (ddx * ddx + ddz * ddz > 64 * 64) continue;
        shown++;
        dim.spawnParticle(q[3] === 0 ? "minecraft:basic_flame_particle" : "minecraft:endrod", {
          x: x + (Math.random() - 0.5) * 2.5,
          y: q[1] + Math.random() * 2,
          z: z + (Math.random() - 0.5) * 2.5,
        });
      }
    } catch (e) {}
  }
}, 10);

// =====================================================================
// FINALE PACK (paste at the VERY END of main.js, no import needed)
//
//  1. MOUNTAIN DRAGON   !dragon  (/scriptevent jester:dragon go)
//     A huge dragon that just landed on the crest of the NORTH mountain. Wings up, front claws
//     gripping the rock, neck arched, head low and looking DOWN at the players in the arena.
//     !dragon arena 2   builds it on the mountain of arena 2.   Run it AFTER !mountain.
//     Live effects: smoke + flames from its mouth and a roar now and then (DRAGON_ALIVE).
//
//  2. MATCH TIMER       starts by itself when a match starts (two roles alive together)
//     Small red boss-bar text at the top middle of the screen: "⏱ 09:58". The bar shrinks with the time.
//     Needs BP/entities/jester_timer.json (see the file next to this one).
//
//  3. FINAL BATTLE      when the timer reaches 00:00
//     Every player still alive in that arena is teleported to the middle of the great hall, close
//     together, frozen for 3 seconds, then FIGHT. The gates of the middle castle are closed with iron
//     bars and nobody can leave the castle walls until the match is over (last role standing wins as
//     before). Then the bars are removed again.
// =====================================================================

// ---------------------------------------------------------------------
// 1. THE MOUNTAIN DRAGON
// ---------------------------------------------------------------------
const DRAGON_PERCH = 120; // height of the dragon's rock perch above the arena floor
const DRAGON_DEPTH = 42; // blocks outside the north border where the dragon stands
const DRAGON_SEED = 9001;
const DRAGON_PARK_HEIGHT = 210; // where the builder parks you (above the wings)
const DRAGON_ALIVE = true; // smoke, flames and roars. false = off
const DRAGON_ARENAS_KEY = "jester_dragon_arenas";

let dragonArenasCache = null;
function getDragonArenas() {
  if (dragonArenasCache) return dragonArenasCache;
  try {
    const raw = world.getDynamicProperty(DRAGON_ARENAS_KEY);
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        dragonArenasCache = v.filter((n) => Number.isInteger(n));
        return dragonArenasCache;
      }
    }
  } catch (e) {}
  dragonArenasCache = [];
  return dragonArenasCache;
}
function markDragonBuilt(n) {
  const list = getDragonArenas();
  if (!list.includes(n)) list.push(n);
  try {
    world.setDynamicProperty(DRAGON_ARENAS_KEY, JSON.stringify(list));
  } catch (e) {}
}
// where the dragon's mouth is (for the flames)
function dragonMouth(a) {
  return { x: a.cx + 0.5, y: a.fy + DRAGON_PERCH + 21, z: a.cz - ARENA_HALF - DRAGON_DEPTH + 36 };
}

// Pure function (no game calls): same shape as generateMountain
function generateMountainDragon(cx, cz, fy, seed) {
  const W = MOUNTAIN_WIDTH;
  const AZ0 = cz - ARENA_HALF;
  const MX0 = cx - ARENA_HALF - W;
  const MZ0 = AZ0 - W;
  const M = ARENA_SIZE + 2 * W;
  const per = 5;
  const C = Math.ceil(M / per);
  const rnd = makeRng(seed);
  const chance = (p) => rnd() < p;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const smooth = (t) => t * t * (3 - 2 * t);

  const DX = cx;
  const DZ = AZ0 - DRAGON_DEPTH;
  const PY = fy + DRAGON_PERCH;
  const ZLO = MZ0; // the dragon lives in the north row of the mountain sections
  const ZHI = MZ0 + C - 1;

  const sections = [];
  for (let ix = 0; ix < per; ix++) {
    sections.push({ x0: MX0 + ix * C, x1: Math.min(MX0 + M - 1, MX0 + (ix + 1) * C - 1), z0: ZLO, z1: ZHI, ops: [] });
  }
  let totalCost = 0;

  const emitBox = (x1, y1, z1, x2, y2, z2, block) => {
    z1 = Math.max(z1, ZLO);
    z2 = Math.min(z2, ZHI);
    if (x1 > x2 || y1 > y2 || z1 > z2) return;
    for (const sec of sections) {
      const px0 = Math.max(x1, sec.x0);
      const px1 = Math.min(x2, sec.x1);
      if (px0 > px1) continue;
      const area = (px1 - px0 + 1) * (z2 - z1 + 1);
      const step = Math.max(1, Math.floor(32000 / area));
      for (let y = y1; y <= y2; y += step) {
        const ye = Math.min(y2, y + step - 1);
        const cost = 1 + Math.floor((area * (ye - y + 1)) / 3000);
        sec.ops.push([`fill ${px0} ${y} ${z1} ${px1} ${ye} ${z2} ${block}`, cost]);
        totalCost += cost;
      }
    }
  };
  // local frame: l = sideways, y = up from the perch (y 0 = top layer of the rock), f = toward the arena (south)
  const lbox = (l1, y1, f1, l2, y2, f2, b) =>
    emitBox(DX + Math.min(l1, l2), PY + Math.min(y1, y2), DZ + Math.min(f1, f2), DX + Math.max(l1, l2), PY + Math.max(y1, y2), DZ + Math.max(f1, f2), b);

  // ---------- the rock perch ----------
  lbox(-11, fy + 50 - PY, -28, 11, -21, 20, "minecraft:stone");
  lbox(-15, -20, -32, 15, -7, 24, "minecraft:deepslate");
  lbox(-19, -6, -35, 19, -1, 27, "minecraft:blackstone");
  lbox(-20, 0, -36, 20, 0, 28, "minecraft:polished_blackstone_bricks");
  for (let i = 0; i < 260; i++) {
    const l = rint(-19, 19);
    const f = rint(-35, 27);
    lbox(l, 0, f, l, 0, f, pick(["minecraft:cracked_polished_blackstone_bricks", "minecraft:blackstone", "minecraft:magma", "minecraft:deepslate_tiles", "minecraft:gravel"]));
  }
  // the hoard and old bones at the sides of the perch
  for (let i = 0; i < 46; i++) {
    const s = chance(0.5) ? 1 : -1;
    const l = s * rint(14, 18);
    const f = rint(-30, -6);
    lbox(l, 1, f, l, rint(1, 3), f, chance(0.8) ? "minecraft:gold_block" : "minecraft:raw_gold_block");
  }
  for (let i = 0; i < 24; i++) {
    const s = chance(0.5) ? 1 : -1;
    lbox(s * rint(14, 19), 1, rint(2, 26), s * rint(14, 19), 1, rint(2, 26), "minecraft:bone_block");
  }
  for (const [l, f] of [[-18, 26], [18, 26], [-18, -34], [18, -34]]) {
    lbox(l, 1, f, l, 1, f, "minecraft:soul_campfire");
  }

  // ---------- voxel helpers ----------
  const vox = new Map();
  const put = (l, y, f, b) => vox.set(`${DX + Math.round(l)},${PY + Math.round(y)},${DZ + Math.round(f)}`, b);
  const comb = (o, ...t) => {
    const r = [o[0], o[1], o[2]];
    for (const [k, v] of t) {
      r[0] += k * v[0];
      r[1] += k * v[1];
      r[2] += k * v[2];
    }
    return r;
  };
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lineThick = (a, b, t, block) => {
    const n = Math.ceil(dist3(a, b) * 1.5) + 1;
    for (let q = 0; q <= n; q++) {
      const f = q / n;
      const px = a[0] + (b[0] - a[0]) * f;
      const py = a[1] + (b[1] - a[1]) * f;
      const pz = a[2] + (b[2] - a[2]) * f;
      for (let ox = 0; ox < t; ox++) for (let oy = 0; oy < t; oy++) for (let oz = 0; oz < t; oz++) put(px + ox, py + oy, pz + oz, block);
    }
  };
  const limb = (pts, th, block) => {
    for (let k = 0; k < pts.length - 1; k++) lineThick(pts[k], pts[k + 1], th[Math.min(k, th.length - 1)], block);
  };
  const tri = (A, B, Cc, block) => {
    const n = Math.ceil(Math.max(dist3(A, B), dist3(B, Cc), dist3(A, Cc)) * 1.6);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        put(A[0] + (B[0] - A[0]) * u + (Cc[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (Cc[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (Cc[2] - A[2]) * v, block);
      }
    }
  };
  // oriented ellipsoid: axes A, B, D (unit vectors), radii ra, rb, rc; outer skin = shellFn(), inside = core
  const oval = (c, A, B, D, ra, rb, rc, shellFn, core) => {
    const R = Math.ceil(Math.max(ra, rb, rc)) + 1;
    const mn = Math.min(ra, rb, rc);
    for (let l = Math.floor(c[0] - R); l <= Math.ceil(c[0] + R); l++) {
      for (let y = Math.floor(c[1] - R); y <= Math.ceil(c[1] + R); y++) {
        for (let f = Math.floor(c[2] - R); f <= Math.ceil(c[2] + R); f++) {
          const dl = l - c[0];
          const dy = y - c[1];
          const df = f - c[2];
          const a = (dl * A[0] + dy * A[1] + df * A[2]) / ra;
          const b = (dl * B[0] + dy * B[1] + df * B[2]) / rb;
          const d = (dl * D[0] + dy * D[1] + df * D[2]) / rc;
          const q = a * a + b * b + d * d;
          if (q > 1) continue;
          put(l, y, f, (1 - Math.sqrt(q)) * mn < 1.3 ? shellFn() : core);
        }
      }
    }
  };
  const AX = [1, 0, 0];
  const AY = [0, 1, 0];
  const AZ = [0, 0, 1];
  // round slice of the body at one f position
  const slice = (f, cl, cy, r, shellFn, coreBlock) => {
    const Wd = (dy) => {
      const v = r * r - dy * dy;
      return v < 0 ? -1 : Math.floor(Math.sqrt(v) + 0.5);
    };
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      const w = Wd(dy);
      if (w < 0) continue;
      const inner = Math.min(Wd(dy - 1), Wd(dy + 1));
      for (let dl = -w; dl <= w; dl++) put(cl + dl, cy + dy, f, Math.abs(dl) > inner ? shellFn(dy, r) : coreBlock);
    }
  };
  // clawed foot: 3 toes with bone claws and a back claw
  const BONE = "minecraft:bone_block";
  const paw = (p, d, len) => {
    const h = Math.hypot(d[0], d[2]) || 1;
    const sl = -d[2] / h;
    const sf = d[0] / h;
    for (const c of [-1, 0, 1]) {
      const mid = [p[0] + d[0] * len * 0.5 + sl * c * 1.8, p[1] + d[1] * len * 0.5, p[2] + d[2] * len * 0.5 + sf * c * 1.8];
      const tip = [p[0] + d[0] * len + sl * c * 3.2, Math.max(1, p[1] + d[1] * len), p[2] + d[2] * len + sf * c * 3.2];
      lineThick(p, mid, 2, "minecraft:blackstone");
      lineThick(mid, tip, 1, "minecraft:polished_blackstone");
      lineThick(tip, [tip[0] + d[0] * 2, Math.max(1, tip[1] - 1), tip[2] + d[2] * 2], 1, BONE);
    }
    lineThick(p, [p[0] - d[0] * 3, Math.max(1, p[1] + 0.5), p[2] - d[2] * 3], 1, BONE);
  };

  const SCALE = ["minecraft:blackstone", "minecraft:blackstone", "minecraft:polished_blackstone", "minecraft:deepslate_bricks", "minecraft:polished_basalt", "minecraft:cracked_deepslate_bricks"];
  const BELLY = ["minecraft:red_nether_bricks", "minecraft:red_nether_bricks", "minecraft:nether_bricks", "minecraft:cracked_nether_bricks"];
  const CORE = "minecraft:blackstone";
  const MEM = "minecraft:red_stained_glass";
  const scale = () => (chance(0.07) ? "minecraft:magma" : pick(SCALE));
  const belly = () => pick(BELLY);

  // ---------- wings: raised and swept back (just landed). NOT mirrored on purpose ----------
  const WINGS = [
    { s: 1, S0: [8, 17, 6], Wr: [38, 50, -4], T: [[66, 47, -16], [62, 26, -30], [44, 10, -36], [24, 5, -30]], Rt: [8, 6, -16] },
    { s: -1, S0: [-8, 17, 6], Wr: [-33, 42, -2], T: [[-58, 34, -14], [-54, 18, -28], [-38, 8, -35], [-21, 4, -29]], Rt: [-8, 6, -16] },
  ];
  for (const Wg of WINGS) {
    const rim = [...Wg.T, Wg.Rt];
    const pull = (a, b) => [0, 1, 2].map((k) => Wg.Wr[k] + ((a[k] + b[k]) / 2 - Wg.Wr[k]) * 0.8);
    for (let k = 0; k < rim.length - 1; k++) {
      const m = pull(rim[k], rim[k + 1]);
      tri(Wg.Wr, rim[k], m, MEM);
      tri(Wg.Wr, m, rim[k + 1], MEM);
    }
    tri(Wg.Wr, Wg.Rt, Wg.S0, MEM);
    lineThick(Wg.S0, Wg.Wr, 3, "minecraft:blackstone"); // arm
    for (const t of Wg.T) {
      lineThick(Wg.Wr, t, 2, "minecraft:polished_blackstone"); // fingers
      lineThick(t, [t[0] + Wg.s * 2, t[1] - 4, t[2] + 2], 1, BONE);
    }
    lineThick(Wg.Wr, [Wg.Wr[0] + Wg.s * 3, Wg.Wr[1] + 10, Wg.Wr[2] + 2], 2, BONE); // thumb claw
  }

  // ---------- body + tail (resting on the perch) ----------
  const spine = (f) => {
    if (f < -12) {
      const u = Math.min(1, (-12 - f) / 25);
      const r = 1.4 + 5.2 * smooth(1 - u);
      return { y: r + 0.3 + 2.5 * Math.sin(u * Math.PI), l: 7 * Math.sin(u * 2.4) * u, r };
    }
    const u = (f + 12) / 22;
    return { y: 7.8 + 5 * u, l: 0, r: 7 + 1.2 * Math.sin(u * Math.PI) };
  };
  for (let f = -37; f <= 10; f++) {
    const s = spine(f);
    slice(f, s.l, s.y, s.r, (dy, r) => (dy < -0.35 * r ? belly() : scale()), () => CORE);
  }
  for (let f = -36; f <= 8; f += 3) {
    const s = spine(f);
    const hgt = Math.max(1, Math.round(1 + s.r * 0.5));
    for (let k = 0; k < hgt; k++) put(s.l, s.y + s.r + k - 0.5, f, BONE);
  }
  const tail = spine(-37);
  lineThick([tail.l, tail.y, -37], [tail.l + 1, tail.y + 3, -37], 1, BONE);

  // ---------- legs: front claws grip the rim of the perch, hind legs planted ----------
  for (const s of [1, -1]) {
    oval([s * 8, 10, 6], AX, AY, AZ, 4.5, 4.5, 4.5, scale, CORE); // shoulder
    oval([s * 8, 8, -6], AX, AY, AZ, 5.5, 5.5, 4.5, scale, CORE); // thigh
    limb([[s * 8, 11, 8], [s * 12, 4, 15], [s * 12, 1.5, 21]], [4, 3], "minecraft:blackstone");
    paw([s * 12, 1.5, 21], [0, -0.1, 1], 5);
    limb([[s * 8, 8, -6], [s * 11, 3, -3], [s * 11, 1.5, 2]], [4, 3], "minecraft:blackstone");
    paw([s * 11, 1.5, 2], [0, 0, 1], 5);
  }

  // ---------- neck: arches up, then drops so the head looks down at the arena ----------
  const P0 = [0, 14, 9];
  const P1 = [0, 38, 15];
  const P2 = [0, 30, 27];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const B = [0, (1 - t) * (1 - t) * P0[1] + 2 * t * (1 - t) * P1[1] + t * t * P2[1], (1 - t) * (1 - t) * P0[2] + 2 * t * (1 - t) * P1[2] + t * t * P2[2]];
    const r = 6.2 - 2.4 * t;
    oval(B, AX, AY, AZ, r, r, r, (dy) => (dy < -0.4 * r ? belly() : scale()), CORE);
    if (i % 3 === 0 && i < 26) {
      for (let k = 0; k < 3; k++) put(0, B[1] + r + k - 0.5, B[2], BONE);
    }
  }

  // ---------- head: pitched about 45 degrees DOWN, mouth open ----------
  const D = [0, -0.7, 0.714]; // looking direction (down and toward the arena)
  const U = [0, 0.714, 0.7]; // up of the head
  const R = [1, 0, 0];
  oval(P2, D, R, U, 6.5, 5.6, 5.2, scale, CORE); // skull
  oval(comb(P2, [9.5, D], [-0.3, U]), D, R, U, 8.5, 3.3, 3.0, scale, CORE); // upper jaw + snout
  oval(comb(P2, [6, D], [-8.5, U]), D, R, U, 7.5, 2.8, 1.9, belly, "minecraft:red_nether_bricks"); // lower jaw (open)
  oval(comb(P2, [1, D], [-4.5, U]), D, R, U, 3.5, 3.5, 3.5, scale, CORE); // jaw joint
  for (let a = 3; a <= 16; a += 2) {
    for (const b of [-2, 2]) put(...comb(P2, [a, D], [b, R], [-3.4, U]), BONE); // upper teeth
  }
  for (let a = 5; a <= 12; a += 2) {
    for (const b of [-2, 2]) put(...comb(P2, [a, D], [b, R], [-6.7, U]), BONE); // lower teeth
  }
  for (let a = 4; a <= 10; a++) {
    put(...comb(P2, [a, D], [0, R], [-5, U]), "minecraft:shroomlight"); // fire glowing in the throat
    put(...comb(P2, [a, D], [0, R], [-4.2, U]), "minecraft:magma");
  }
  for (const s of [-1, 1]) {
    const e = comb(P2, [2.8, D], [2.8, U], [s * 4.3, R]);
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(e[0] + ox, e[1] + oy, e[2], "minecraft:ochre_froglight"); // glowing eyes
    for (let k = 0; k <= 12; k++) {
      // horns sweep back and out
      const h = comb(P2, [4.2, U], [s * 3.2, R], [k, comb([0, 0, 0], [-1.1, D], [0.55, U])], [s * k * 0.45, R], [-0.02 * k * k, U]);
      const size = k < 6 ? 2 : 1;
      for (let ox = 0; ox < size; ox++) for (let oy = 0; oy < size; oy++) for (let oz = 0; oz < size; oz++) put(h[0] + ox, h[1] + oy, h[2] + oz, BONE);
    }
    for (let k = 0; k < 4; k++) put(...comb(P2, [-1 - k * 1.5, D], [s * (5 + k * 0.6), R], [-2.5, U]), BONE); // cheek spikes
  }

  // ---------- voxel map -> fill commands (runs along x are merged) ----------
  const rows = new Map();
  for (const [key, b] of vox) {
    const [x, y, z] = key.split(",").map(Number);
    const rk = `${b}|${y}|${z}`;
    let r = rows.get(rk);
    if (!r) rows.set(rk, (r = []));
    r.push(x);
  }
  for (const [rk, xs] of rows) {
    const [b, ys, zs] = rk.split("|");
    const y = Number(ys);
    const z = Number(zs);
    xs.sort((p, q) => p - q);
    let a = xs[0];
    let prev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === prev + 1) {
        prev = xs[i];
        continue;
      }
      emitBox(a, y, z, prev, y, z, b);
      if (i < xs.length) {
        a = xs[i];
        prev = xs[i];
      }
    }
  }

  // X0..Z1 = the whole mountain rectangle, so the builder parks you back in the arena afterwards
  return { sections: sections.filter((s) => s.ops.length > 0), totalCost, X0: MX0, X1: MX0 + M - 1, Z0: MZ0, Z1: MZ0 + M - 1 };
}

function buildMountainDragon(player, opts) {
  if (arenaBusy) {
    player.sendMessage("§cThe arena (or mountain or sky) is already being built.");
    return;
  }
  arenaBusy = true;
  try {
    const dim = world.getDimension(DIMENSION);
    const a = getArenaByIndex(opts.arenaIndex ?? 0);
    const gen = generateMountainDragon(a.cx, a.cz, a.fy, DRAGON_SEED);
    const minutes = Math.max(1, Math.round(gen.totalCost / ARENA_BUDGET / 20 / 60));
    player.sendMessage(
      `§eBuilding the mountain dragon on the north mountain of arena ${a.index + 1} (${gen.sections.length} sections). ` +
        `Takes about ${minutes}+ minute(s). Run !mountain first if the mountain is not there yet. You will be moved around. Stay in the world.`
    );
    runArenaSections(player, dim, gen, a.fy, {
      parkY: DRAGON_PARK_HEIGHT,
      label: "Dragon",
      cmd: "dragon",
      onFinish: () => markDragonBuilt(a.index),
    });
  } catch (e) {
    arenaBusy = false;
    player.sendMessage("§cDragon failed to start: " + e);
    console.warn("[dragon] failed to start: " + e);
  }
}

function runDragonCommand(player, message) {
  if (!player || player.typeId !== "minecraft:player") return;
  if (!canUseArenaCommands(player)) {
    player.sendMessage("§cYou need the tag \"" + ARENA_ADMIN_TAG + "\" to use this command.");
    return;
  }
  const words = (message || "").trim().toLowerCase().split(/\s+/);
  buildMountainDragon(player, { arenaIndex: parseArenaNumber(words) });
}

try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = (ev.message || "").trim();
    if (!/^!dragon(\s|$)/i.test(msg)) return;
    ev.cancel = true;
    const player = ev.sender;
    system.run(() => runDragonCommand(player, msg.slice(7)));
  });
} catch (e) {
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "jester:dragon") return;
  let player = ev.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") player = world.getAllPlayers()[0];
  if (!player) return;
  system.runTimeout(() => {
    try {
      runDragonCommand(player, ev.message);
    } catch (e) {
      arenaBusy = false;
      console.warn("[dragon] jester:dragon failed: " + e);
    }
  }, 2);
});

// Live dragon: smoke and flames from the mouth, a roar every ~30 seconds (only near players)
let dragonBeat = 0;
system.runInterval(() => {
  if (!DRAGON_ALIVE || arenaBusy) return;
  const built = getDragonArenas();
  if (built.length === 0) return;
  dragonBeat++;
  const arenas = getArenaList();
  const dim = world.getDimension(DIMENSION);
  for (const n of built) {
    const a = arenas[n];
    if (!a) continue;
    const near = world.getAllPlayers().filter((p) => {
      try {
        const l = p.location;
        return p.dimension.id === dim.id && Math.abs(l.x - a.cx) <= ARENA_HALF + MOUNTAIN_WIDTH && Math.abs(l.z - a.cz) <= ARENA_HALF + MOUNTAIN_WIDTH;
      } catch (e) {
        return false;
      }
    });
    if (near.length === 0) continue;
    const m = dragonMouth(a);
    try {
      for (let i = 0; i < 6; i++) {
        dim.spawnParticle("minecraft:basic_smoke_particle", { x: m.x + (Math.random() - 0.5) * 5, y: m.y + 3 + Math.random() * 3, z: m.z + (Math.random() - 0.5) * 5 });
      }
      for (let i = 0; i < 8; i++) {
        const k = Math.random() * 9;
        dim.spawnParticle("minecraft:basic_flame_particle", { x: m.x + (Math.random() - 0.5) * 3, y: m.y - k * 1.3, z: m.z + k * 1.1 + Math.random() });
      }
    } catch (e) {}
    if (dragonBeat % 60 === 0) {
      for (const p of near) {
        try {
          p.playSound("mob.enderdragon.growl", { volume: 3, pitch: 0.6 });
        } catch (e) {}
      }
    }
  }
}, 10);

// ---------------------------------------------------------------------
// 2. MATCH TIMER (boss bar text, top middle of the screen)
// ---------------------------------------------------------------------
const MATCH_SECONDS = 600; // 10 minutes (keep it at or below "max" in jester_timer.json, 600)
const TIMER_ENTITY = "jester:timer";
const TIMER_TEXT_COLOR = "§c§l"; // red, bold
const TIMER_WARN_AT = [60, 30, 10];

// ---------------------------------------------------------------------
// 3. FINAL BATTLE (castle in the middle is sealed)
// ---------------------------------------------------------------------
const CASTLE_WALL_HALF = 40; // the curtain wall of the middle castle (CW in the arena builder)
const CASTLE_GATE_HALF = 6; // gates are 12 wide
const CASTLE_ZONE_HALF = 36.5; // players may walk inside this square (center of the arena) only
const FINAL_GATHER_DELAY = 40; // ticks between "TIME'S UP" and the teleport
const FINAL_FREEZE_TICKS = 60; // 3 seconds to look around before the fight

const matchTimers = new Map(); // arena index -> { end, lastSec, warned, final }
const finalLocked = new Set(); // arena indexes whose castle is sealed
let timerFallback = false; // true = boss bar entity is missing, the timer goes to the action bar instead
let timerSpawnFails = 0;

const timerTag = (n) => "cnmb_timer_" + n;
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function showTimer(n, a, text, frac) {
  const dim = world.getDimension(DIMENSION);
  const pos = { x: a.cx + 0.5, y: a.fy + 30, z: a.cz + 0.5 };
  try {
    let e = dim.getEntities({ type: TIMER_ENTITY, tags: [timerTag(n)] })[0];
    if (!e) {
      if (!dim.getBlock(pos)) return; // chunk not loaded yet
      e = dim.spawnEntity(TIMER_ENTITY, pos);
      e.addTag(timerTag(n));
    }
    if (e.nameTag !== text) e.nameTag = text;
    const hp = e.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(Math.max(1, Math.min(hp.effectiveMax, Math.round(hp.effectiveMax * frac))));
    timerSpawnFails = 0;
  } catch (err) {
    timerSpawnFails++;
    if (timerSpawnFails >= 3 && !timerFallback) {
      timerFallback = true;
      console.warn("[timer] could not use the entity " + TIMER_ENTITY + " (is BP/entities/jester_timer.json installed?). Using the action bar. " + err);
    }
  }
}

function startTimer(n) {
  const a = getArenaByIndex(n);
  const dim = world.getDimension(DIMENSION);
  const T = { end: system.currentTick + MATCH_SECONDS * 20, lastSec: -1, warned: new Set(), final: false };
  matchTimers.set(n, T);
  try {
    dim.runCommand(`tickingarea add circle ${a.cx} ${a.fy} ${a.cz} 2 cnmb_timer_${n}`); // keeps the timer entity loaded
  } catch (e) {}
  for (const p of membersOf(n)) {
    try {
      p.sendMessage(`§c⏱ The match timer started: §f${fmtTime(MATCH_SECONDS)}§c. When it ends, everyone left fights in the middle castle!`);
    } catch (e) {}
  }
}

function stopTimer(n) {
  matchTimers.delete(n);
  const a = getArenaByIndex(n);
  const dim = world.getDimension(DIMENSION);
  try {
    for (const e of dim.getEntities({ type: TIMER_ENTITY, tags: [timerTag(n)] })) e.remove();
  } catch (e) {}
  try {
    dim.runCommand(`tickingarea remove cnmb_timer_${n}`);
  } catch (e) {}
  if (finalLocked.delete(n)) setCastleGates(a, false);
}

// Closes (or opens) the four gates of the middle castle with iron bars
function setCastleGates(a, sealed) {
  const dim = world.getDimension(DIMENSION);
  const CW = CASTLE_WALL_HALF;
  const H = CASTLE_GATE_HALF;
  const y1 = a.fy + 1;
  const y2 = a.fy + 14;
  const boxes = [
    [a.cx - H, a.cz - CW + 1, a.cx + H - 1, a.cz - CW + 1], // north gate (middle of the 3 thick wall)
    [a.cx - H, a.cz + CW - 2, a.cx + H - 1, a.cz + CW - 2], // south gate
    [a.cx - CW + 1, a.cz - H, a.cx - CW + 1, a.cz + H - 1], // west gate
    [a.cx + CW - 2, a.cz - H, a.cx + CW - 2, a.cz + H - 1], // east gate
  ];
  for (const [x1, z1, x2, z2] of boxes) {
    try {
      dim.runCommand(
        sealed
          ? `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:iron_bars`
          : `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:air replace minecraft:iron_bars`
      );
    } catch (e) {
      console.warn("[final] gate fill failed: " + e);
    }
  }
}

// first free spot (feet + head are air) at x, z, starting just above the floor
function safeStandY(dim, x, z, fy) {
  for (let y = fy + 1; y <= fy + 5; y++) {
    try {
      const b1 = dim.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
      const b2 = dim.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
      if (b1 && b2 && b1.isAir && b2.isAir) return y;
    } catch (e) {}
  }
  return fy + 1;
}

function startFinale(n) {
  const T = matchTimers.get(n);
  if (!T || T.final) return;
  T.final = true;
  const a = getArenaByIndex(n);
  showTimer(n, a, "§4§l⚔ FINAL BATTLE ⚔", 1);
  for (const p of membersOf(n)) {
    try {
      p.onScreenDisplay.setTitle("§c§l⏱ TIME'S UP!", {
        subtitle: "§eEveryone left goes to the middle castle!",
        fadeInDuration: 5,
        stayDuration: 50,
        fadeOutDuration: 10,
      });
      p.playSound("raid.horn", { volume: 2, pitch: 1 });
      p.playSound("mob.enderdragon.growl", { volume: 3, pitch: 0.6 });
    } catch (e) {}
  }
  world.sendMessage(`§c§l⏱ Arena ${n + 1}: time is up! Everyone left fights in the middle castle until the match ends!`);
  system.runTimeout(() => gatherInCastle(n), FINAL_GATHER_DELAY);
}

function gatherInCastle(n) {
  const st = getArenaState(n);
  if (!st.active || st.ending || !matchTimers.has(n)) return;
  const a = getArenaByIndex(n);
  const dim = world.getDimension(DIMENSION);
  // players of the same role stand next to each other
  const alive = aliveIn(n).sort((p, q) => roleCfgOf(p).tag.localeCompare(roleCfgOf(q).tag));

  alive.forEach((p, i) => {
    let r;
    let ang;
    if (i < 12) {
      r = 6;
      ang = (i / 12) * Math.PI * 2 + 0.3;
    } else if (i < 32) {
      r = 9;
      ang = ((i - 12) / 20) * Math.PI * 2 + 0.15;
    } else {
      r = 4.5 + Math.random() * 4.5;
      ang = Math.random() * Math.PI * 2;
    }
    const x = a.cx + 0.5 + Math.cos(ang) * r;
    const z = a.cz + 0.5 + Math.sin(ang) * r;
    const y = safeStandY(dim, x, z, a.fy);
    try {
      unfreezeEffects(p); // in case they were still frozen by the start countdown
      p.teleport({ x, y, z }, { dimension: dim, facingLocation: { x: a.cx + 0.5, y: a.fy + 2, z: a.cz + 0.5 } });
      p.clearVelocity();
      freezeEffects(p);
      p.onScreenDisplay.setTitle("§c§l⚔ FINAL BATTLE", {
        subtitle: "§7The castle is sealed. Last one standing wins!",
        fadeInDuration: 2,
        stayDuration: FINAL_FREEZE_TICKS - 12,
        fadeOutDuration: 8,
      });
      p.playSound("mob.endermen.portal", { volume: 1, pitch: 1 });
    } catch (e) {
      console.warn("[final] teleport failed: " + e);
    }
  });

  finalLocked.add(n);
  setCastleGates(a, true);

  system.runTimeout(() => {
    for (const p of alive) {
      try {
        unfreezeEffects(p);
        p.onScreenDisplay.setTitle("§c§l⚔ FIGHT! ⚔", { fadeInDuration: 0, stayDuration: 25, fadeOutDuration: 10 });
        p.playSound("random.totem", { volume: 1, pitch: 1 });
        p.playSound("random.levelup", { volume: 1, pitch: 1.2 });
      } catch (e) {}
    }
  }, FINAL_FREEZE_TICKS);
}

// Nobody leaves the castle while it is sealed (also catches ender pearls, falls from the wall, etc.)
const castleWarnTick = new Map();
system.runInterval(() => {
  if (finalLocked.size === 0) return;
  const arenas = getArenaList();
  for (const n of finalLocked) {
    const a = arenas[n];
    if (!a) continue;
    for (const p of aliveIn(n)) {
      try {
        const l = p.location;
        const dx = l.x - a.cx;
        const dz = l.z - a.cz;
        if (Math.abs(dx) <= CASTLE_ZONE_HALF && Math.abs(dz) <= CASTLE_ZONE_HALF) continue;
        const lim = CASTLE_ZONE_HALF - 1;
        const nx = a.cx + Math.max(-lim, Math.min(lim, dx));
        const nz = a.cz + Math.max(-lim, Math.min(lim, dz));
        const ny = Math.max(a.fy + 1, Math.min(l.y, a.fy + 2)); // back down to the floor, no fall damage
        p.teleport({ x: nx, y: ny, z: nz });
        p.clearVelocity();
        const last = castleWarnTick.get(p.id) ?? -100;
        if (system.currentTick - last > 20) {
          castleWarnTick.set(p.id, system.currentTick);
          p.onScreenDisplay.setActionBar("§c§lThe castle is sealed until the battle ends!");
          p.playSound("note.bass", { volume: 1, pitch: 0.8 });
        }
      } catch (e) {}
    }
  }
}, 2);

// ---------- timer loop: starts / updates / ends the timer of every arena ----------
function matchTimerTick() {
  const now = system.currentTick;
  for (const a of getArenaList()) {
    const n = a.index;
    const st = getArenaState(n);
    const T = matchTimers.get(n);

    if (T && (!st.active || st.ending)) {
      stopTimer(n); // match over: remove the timer, open the gates
      continue;
    }
    if (!T) {
      if (st.active && !st.ending && !arenaCountdown) startTimer(n); // not while the start countdown is running
      continue;
    }

    if (T.final) {
      if (now % 100 < 5) showTimer(n, a, "§4§l⚔ FINAL BATTLE ⚔", 1);
      continue;
    }

    const left = T.end - now;
    const rem = Math.max(0, Math.ceil(left / 20));
    if (rem !== T.lastSec) {
      T.lastSec = rem;
      const text = `${TIMER_TEXT_COLOR}⏱ ${fmtTime(rem)}`;
      showTimer(n, a, text, rem / MATCH_SECONDS);
      if (timerFallback) {
        for (const p of aliveIn(n)) {
          try {
            p.onScreenDisplay.setActionBar(text);
          } catch (e) {}
        }
      }
      if (TIMER_WARN_AT.includes(rem) && !T.warned.has(rem)) {
        T.warned.add(rem);
        for (const p of membersOf(n)) {
          try {
            p.sendMessage(`§c⏱ ${rem} seconds until the final battle in the middle castle!`);
            p.playSound("note.pling", { volume: 1, pitch: 1.4 });
          } catch (e) {}
        }
      } else if (rem <= 5 && rem > 0) {
        for (const p of membersOf(n)) {
          try {
            p.playSound("note.hat", { volume: 1, pitch: 1.2 });
          } catch (e) {}
        }
      }
    } else if (now % 40 < 5 && !timerFallback) {
      showTimer(n, a, `${TIMER_TEXT_COLOR}⏱ ${fmtTime(rem)}`, rem / MATCH_SECONDS); // brings it back if it was removed
    }
    if (left <= 0) startFinale(n);
  }
}
system.runInterval(() => {
  try {
    matchTimerTick();
  } catch (e) {
    console.warn("[timer] tick failed: " + e);
  }
}, 5);

// Leftover timer entities (after a /reload or a crash): remove the ones nobody owns
system.runInterval(() => {
  if (matchTimers.size > 0) return;
  try {
    for (const e of world.getDimension(DIMENSION).getEntities({ type: TIMER_ENTITY })) e.remove();
  } catch (e) {}
}, 200);