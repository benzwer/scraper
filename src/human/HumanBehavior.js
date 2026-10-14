const { sleep, rand, randInt, delay } = require('../utils/random');

// Simulates how a person interacts with ONE page: mouse, wheel, clicks, pauses.
// One instance per page, so the mouse position is just an attribute.
class HumanBehavior {
  constructor(page, timing) {
    this.page = page;
    this.timing = timing;
    this.pos = null;
  }

  pause(range) {
    return delay(range[0], range[1]);
  }

  async viewport() {
    return this.page.evaluate(() => ({
      w: window.innerWidth,
      h: window.innerHeight
    }));
  }

  async currentPos() {
    if (!this.pos) {
      const vp = await this.viewport();
      this.pos = {
        x: rand(vp.w * 0.3, vp.w * 0.7),
        y: rand(vp.h * 0.3, vp.h * 0.7)
      };
    }
    return this.pos;
  }

  // Cubic Bézier curve with ease-in/ease-out.
  async moveTo(targetX, targetY) {
    const start = await this.currentPos();
    const dx = targetX - start.x;
    const dy = targetY - start.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 2) return;

    const steps = Math.max(12, Math.min(80, Math.round(distance / 12 + rand(8, 18))));
    const spread = Math.max(20, distance * 0.25);

    const c1 = {
      x: start.x + dx * 0.3 + rand(-spread, spread),
      y: start.y + dy * 0.3 + rand(-spread, spread)
    };
    const c2 = {
      x: start.x + dx * 0.7 + rand(-spread, spread),
      y: start.y + dy * 0.7 + rand(-spread, spread)
    };

    for (let i = 1; i <= steps; i++) {
      const t0 = i / steps;
      const t = t0 < 0.5 ? 2 * t0 * t0 : 1 - Math.pow(-2 * t0 + 2, 2) / 2;
      const u = 1 - t;

      const x =
        u * u * u * start.x + 3 * u * u * t * c1.x +
        3 * u * t * t * c2.x + t * t * t * targetX;
      const y =
        u * u * u * start.y + 3 * u * u * t * c1.y +
        3 * u * t * t * c2.y + t * t * t * targetY;

      await this.page.mouse.move(x, y);
      await sleep(rand(4, 14));
    }

    this.pos = { x: targetX, y: targetY };
  }

  // Small involuntary movements while "reading".
  async idleJitter() {
    const vp = await this.viewport();
    const pos = await this.currentPos();

    for (let i = 0; i < randInt(2, 4); i++) {
      const x = Math.min(vp.w - 5, Math.max(5, pos.x + rand(-25, 25)));
      const y = Math.min(vp.h - 5, Math.max(5, pos.y + rand(-18, 18)));
      await this.moveTo(x, y);
      await sleep(rand(80, 300));
    }
  }

  async wheel(total) {
    const sign = Math.sign(total);
    let remaining = Math.abs(total);

    while (remaining > 0) {
      const chunk = Math.min(remaining, randInt(40, 130));
      await this.page.mouse.wheel(0, sign * chunk);
      remaining -= chunk;
      await sleep(rand(12, 45));
    }
  }

  // Scrolls in steps with reading pauses and the occasional scroll back up.
  async readingScroll(maxMs = this.timing.maxScrollTimeMs) {
    const deadline = Date.now() + maxMs;

    while (Date.now() < deadline) {
      const state = await this.page.evaluate(() => ({
        y: window.scrollY,
        max: document.documentElement.scrollHeight - window.innerHeight
      }));

      if (state.y >= state.max - 5) break;

      await this.wheel(randInt(250, 650));
      await this.pause(this.timing.readingPauseMs);

      if (Math.random() < 0.12) {
        await this.wheel(-randInt(80, 260));
        await delay(400, 1200);
      }

      if (Math.random() < 0.3) await this.idleJitter();
    }
  }

  // Brings an element into view using the mouse wheel.
  async scrollToElement(locator) {
    for (let i = 0; i < 40; i++) {
      const box = await locator.boundingBox();
      if (!box) return;

      const vp = await this.viewport();
      const centerY = box.y + box.height / 2;

      if (centerY >= vp.h * 0.12 && centerY <= vp.h * 0.88) return;

      const before = await this.page.evaluate(() => window.scrollY);
      await this.wheel((centerY > vp.h * 0.5 ? 1 : -1) * randInt(250, 550));
      await sleep(rand(120, 350));
      const after = await this.page.evaluate(() => window.scrollY);

      // The page no longer moves (fixed element or end of page).
      if (Math.abs(after - before) < 2) return;
    }

    await locator.scrollIntoViewIfNeeded().catch(() => {});
  }

  async click(locator) {
    await this.scrollToElement(locator);

    const box = await locator.boundingBox();
    if (!box) throw new Error('Element not visible: cannot click.');

    const targetX = box.x + box.width * rand(0.25, 0.75);
    const targetY = box.y + box.height * rand(0.3, 0.7);

    // Occasionally overshoot the target and correct.
    if (Math.random() < 0.25) {
      await this.moveTo(targetX + rand(-30, 30), targetY + rand(-20, 20));
      await sleep(rand(60, 160));
    }

    await this.moveTo(targetX, targetY);
    await sleep(rand(80, 250));
    await this.page.mouse.down();
    await sleep(rand(40, 120));
    await this.page.mouse.up();
  }

  // Hovers a random element, as if looking at it more closely.
  async hoverRandom(selector) {
    try {
      const items = this.page.locator(selector);
      const count = await items.count();
      if (count === 0) return;

      const item = items.nth(randInt(0, count - 1));
      await this.scrollToElement(item);

      const box = await item.boundingBox();
      if (!box) return;

      await this.moveTo(
        box.x + box.width * rand(0.2, 0.8),
        box.y + box.height * rand(0.2, 0.8)
      );
      await delay(700, 2500);
    } catch {
      // Not essential.
    }
  }
}

module.exports = { HumanBehavior };
