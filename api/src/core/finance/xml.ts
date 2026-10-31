export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function xmlText(value: string, max: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  const cut = Array.from(clean).slice(0, max).join('');
  return xmlEscape(cut);
}

export function parseXml(source: string): XmlNode {
  const xml = source.replace(/^\uFEFF/, '').trim();
  let index = 0;
  if (xml.startsWith('<?')) {
    const end = xml.indexOf('?>');
    if (end < 0) fail();
    index = end + 2;
  }
  skip();
  const root = element();
  skip();
  return root;

  function fail(): never {
    throw new Error('XML no válido');
  }

  function skip(): void {
    while (index < xml.length && /\s/.test(xml[index] ?? '')) index += 1;
  }

  function local(name: string): string {
    const colon = name.lastIndexOf(':');
    return colon >= 0 ? name.slice(colon + 1) : name;
  }

  function readName(): string {
    const start = index;
    while (index < xml.length && /[\w:.-]/.test(xml[index] ?? '')) index += 1;
    if (index === start) fail();
    return xml.slice(start, index);
  }

  function decode(value: string): string {
    return value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&');
  }

  function element(): XmlNode {
    if (xml[index] !== '<') fail();
    index += 1;
    if (xml[index] === '/' || xml[index] === '!' || xml[index] === '?') fail();
    const name = local(readName());
    const attrs: Record<string, string> = {};
    while (index < xml.length) {
      skip();
      if (xml.startsWith('/>', index)) {
        index += 2;
        return { name, attrs, children: [], text: '' };
      }
      if (xml[index] === '>') {
        index += 1;
        break;
      }
      const attr = local(readName());
      skip();
      if (xml[index] !== '=') fail();
      index += 1;
      skip();
      const quote = xml[index];
      if (quote !== '"' && quote !== "'") fail();
      index += 1;
      const start = index;
      while (index < xml.length && xml[index] !== quote) index += 1;
      if (xml[index] !== quote) fail();
      attrs[attr] = decode(xml.slice(start, index));
      index += 1;
    }
    const children: XmlNode[] = [];
    let text = '';
    while (index < xml.length) {
      if (xml.startsWith('</', index)) {
        index += 2;
        const close = local(readName());
        if (close !== name) fail();
        skip();
        if (xml[index] !== '>') fail();
        index += 1;
        return { name, attrs, children, text: decode(text).trim() };
      }
      if (xml.startsWith('<!--', index)) {
        const end = xml.indexOf('-->', index);
        if (end < 0) fail();
        index = end + 3;
        continue;
      }
      if (xml[index] === '<') {
        children.push(element());
        continue;
      }
      const start = index;
      while (index < xml.length && xml[index] !== '<') index += 1;
      text += xml.slice(start, index);
    }
    fail();
  }
}

export function child(node: XmlNode | null, name: string): XmlNode | null {
  return node?.children.find((item) => item.name === name) ?? null;
}

export function children(node: XmlNode | null, name: string): XmlNode[] {
  return node?.children.filter((item) => item.name === name) ?? [];
}

export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const item of node.children) {
    if (item.name === name) out.push(item);
    descendants(item, name, out);
  }
  return out;
}

export function textAt(node: XmlNode | null, ...path: string[]): string {
  let current = node;
  for (const name of path) current = child(current, name);
  return current?.text ?? '';
}
