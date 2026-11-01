import type { Page } from "playwright/test";

/** iPhone 12-14: 390x844 css px, táctil, letra y zona de España. */
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

export const MOBILE_CONTEXT = {
  viewport: MOBILE_VIEWPORT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  locale: "es-ES",
  timezoneId: "Europe/Madrid",
  reducedMotion: "reduce",
  colorScheme: "light",
} as const;

export type FindingKind =
  | "page-overflow"
  | "viewport-overflow"
  | "clipped"
  | "touch-target"
  | "touch-target-inline"
  | "font-size"
  | "dialog-tall"
  | "dialog-cta-offscreen"
  | "dialog-no-scroll"
  | "truncated";

export type Finding = {
  kind: FindingKind;
  where: string;
  detail: string;
};

export type Measurement = {
  scrollWidth: number;
  clientWidth: number;
  findings: Finding[];
};

/**
 * Mide la pantalla visible en el navegador. Todo va dentro de una sola función para que
 * Playwright la serialice tal cual: no puede usar nada de fuera.
 */
export async function measure(page: Page): Promise<Measurement> {
  const result = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const findings: { kind: string; where: string; detail: string }[] = [];
    const seen = new Set<string>();

    const doc = document.documentElement;
    const INTERACTIVE =
      'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=radio], [role=switch], [role=option], [role=link], [tabindex="0"]';

    function describe(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const classes = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((name) => name && !name.includes(":") && !name.includes("["))
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join("");
      const label =
        el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        (el as HTMLElement).innerText ??
        el.textContent ??
        "";
      const text = label.replace(/\s+/g, " ").trim().slice(0, 40);
      const screen = el.closest("[data-screen]")?.getAttribute("data-screen");
      return `${screen ? `[${screen}] ` : ""}${tag}${id}${classes}${text ? ` «${text}»` : ""}`;
    }

    function add(kind: string, el: Element, detail: string) {
      const where = describe(el);
      const key = `${kind}|${where}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ kind, where, detail });
    }

    function hiddenByStyle(el: Element): boolean {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return true;
        if (Number(style.opacity) === 0) return true;
        if (node.getAttribute("aria-hidden") === "true" && node.tagName !== "BODY") {
          // Un contenedor aria-hidden sigue pudiendo verse (decoración): no lo descartamos.
        }
      }
      return false;
    }

    function srOnly(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      return rect.width <= 1 && rect.height <= 1;
    }

    /** La parte del elemento que de verdad se ve: recortada por los ancestros con overflow. */
    function visibleRect(el: Element): DOMRect | null {
      const rect = el.getBoundingClientRect();
      let left = rect.left;
      let right = rect.right;
      let top = rect.top;
      let bottom = rect.bottom;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === "fixed" && node !== el.parentElement) {
          // Los fijos recortan igual: seguimos al ancestro.
        }
        const clipsX = style.overflowX !== "visible";
        const clipsY = style.overflowY !== "visible";
        if (!clipsX && !clipsY) continue;
        const box = node.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, box.left);
          right = Math.min(right, box.right);
        }
        if (clipsY) {
          top = Math.max(top, box.top);
          bottom = Math.min(bottom, box.bottom);
        }
      }
      if (right <= left || bottom <= top) return null;
      return new DOMRect(left, top, right - left, bottom - top);
    }

    function isShown(el: Element): boolean {
      if (el.closest(".sr-only")) return false;
      if (hiddenByStyle(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return visibleRect(el) !== null;
    }

    /** ¿Hay un ancestro con scroll horizontal que contenga el elemento? Entonces no desborda la página. */
    function insideScrollX(el: Element): boolean {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "auto" || style.overflowX === "scroll") {
          const box = node.getBoundingClientRect();
          if (box.left >= -1 && box.right <= vw + 1) return true;
        }
      }
      return false;
    }

    function clippedByAncestor(el: Element): boolean {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "hidden" || style.overflowX === "clip") {
          const box = node.getBoundingClientRect();
          if (box.left >= -1 && box.right <= vw + 1) return true;
        }
      }
      return false;
    }

    // 1. Desbordamiento de la página entera.
    const scrollWidth = Math.max(doc.scrollWidth, document.body.scrollWidth);
    if (scrollWidth > doc.clientWidth + 1) {
      findings.push({
        kind: "page-overflow",
        where: "documentElement",
        detail: `scrollWidth ${scrollWidth} > clientWidth ${doc.clientWidth}`,
      });
    }

    // 2. Elementos que sobresalen del viewport sin un scroll horizontal que los contenga.
    const all = Array.from(document.body.querySelectorAll("*"));
    const offenders = new Set<Element>();
    for (const el of all) {
      if (el.closest("[data-measure-ignore]")) continue;
      if (!isShown(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right <= vw + 1 && rect.left >= -1) continue;
      if (srOnly(el)) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        const box = visibleRect(el);
        if (box && box.right <= vw + 1 && box.left >= -1) continue;
      }
      if (insideScrollX(el)) continue;
      if (clippedByAncestor(el)) {
        // Lo corta un overflow hidden: es contenido perdido, no scroll de página.
        const inner = el.closest("svg") ? null : el;
        if (inner && (el.children.length === 0 || (el as HTMLElement).innerText)) {
          offenders.add(el);
        }
        continue;
      }
      offenders.add(el);
    }
    for (const el of offenders) {
      let ancestorReported = false;
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (offenders.has(node)) {
          ancestorReported = true;
          break;
        }
      }
      if (ancestorReported) continue;
      const rect = el.getBoundingClientRect();
      add(
        "viewport-overflow",
        el,
        `x ${Math.round(rect.left)}→${Math.round(rect.right)} (ancho ${Math.round(rect.width)}, viewport ${vw})`,
      );
    }

    // 3. Contenido cortado por overflow hidden dentro del propio viewport.
    for (const el of all) {
      if (el.closest("[data-measure-ignore]")) continue;
      const style = getComputedStyle(el);
      if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
      const node = el as HTMLElement;
      if (node.scrollWidth <= node.clientWidth + 2) continue;
      if (!isShown(el)) continue;
      if (el.tagName === "BODY" || el.tagName === "HTML") continue;
      if (style.textOverflow === "ellipsis") {
        add("truncated", el, `scrollWidth ${node.scrollWidth} > clientWidth ${node.clientWidth}`);
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 4) continue;
      add("clipped", el, `scrollWidth ${node.scrollWidth} > clientWidth ${node.clientWidth}`);
    }

    // 4. Objetivos táctiles menores de 40 px y entradas con letra menor de 16 px.
    for (const el of Array.from(document.body.querySelectorAll(INTERACTIVE))) {
      if (el.closest("[data-measure-ignore]")) continue;
      if (!isShown(el)) continue;
      if (srOnly(el)) continue;
      const input = el as HTMLInputElement;
      const type = el.tagName === "INPUT" ? input.type : "";
      let target: Element = el;
      if (type === "checkbox" || type === "radio") {
        const label = el.closest("label");
        if (label) target = label;
      }
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      if (style.pointerEvents === "none") continue;
      // Un pseudoelemento absoluto (utilidad touch-hit) recoge el toque más allá del borde visible.
      let hitWidth = rect.width;
      let hitHeight = rect.height;
      for (const pseudo of ["::after", "::before"]) {
        const extra = getComputedStyle(target, pseudo);
        if (extra.content !== "none" && extra.position === "absolute") {
          hitWidth = Math.max(hitWidth, parseFloat(extra.width) || 0);
          hitHeight = Math.max(hitHeight, parseFloat(extra.height) || 0);
        }
      }
      const small = hitWidth < 40 || hitHeight < 40;
      if (small) {
        const inline = style.display === "inline" && el.tagName === "A";
        add(
          inline ? "touch-target-inline" : "touch-target",
          target,
          `${Math.round(hitWidth)}x${Math.round(hitHeight)} px`,
        );
      }
      if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
        const skip = ["checkbox", "radio", "range", "file", "hidden", "button", "submit", "color"].includes(type);
        if (!skip) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 16) add("font-size", el, `${size}px`);
        }
      }
    }

    // 5. Diálogos: alto, scroll interno y botones fuera de vista.
    for (const dialog of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      if (!isShown(dialog)) continue;
      const box = dialog.getBoundingClientRect();
      const node = dialog as HTMLElement;
      let scroller: HTMLElement | null = null;
      for (const child of Array.from(dialog.querySelectorAll<HTMLElement>("*"))) {
        const style = getComputedStyle(child);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && child.scrollHeight > child.clientHeight + 1) {
          scroller = child;
          break;
        }
      }
      if (box.height > vh + 1) {
        add("dialog-tall", dialog, `alto ${Math.round(box.height)} > viewport ${vh}`);
      }
      if (node.scrollHeight > node.clientHeight + 1 && !scroller) {
        add("dialog-no-scroll", dialog, `scrollHeight ${node.scrollHeight} > clientHeight ${node.clientHeight}`);
      }
      for (const button of Array.from(dialog.querySelectorAll<HTMLElement>("button, a[href], [role=button]"))) {
        if (!isShown(button)) continue;
        const rect = button.getBoundingClientRect();
        if (rect.bottom > vh + 1 || rect.top < -1) {
          // Un botón dentro de la zona con scroll no cuenta: está accesible desplazando.
          if (scroller && scroller.contains(button)) continue;
          add("dialog-cta-offscreen", button, `top ${Math.round(rect.top)} bottom ${Math.round(rect.bottom)} (viewport ${vh})`);
        }
      }
    }

    return { scrollWidth, clientWidth: doc.clientWidth, findings };
  });
  return result as Measurement;
}
