import { useRef, useState } from "react";
import { Copy, MoreVertical } from "@/ui/icons";
import { NoPermission } from "@/components/NoPermission";
import { useApi } from "@/hooks/use-api";
import { copy, fill } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { iconStroke } from "@/lib/motion";
import type { Me } from "@/lib/types";
import { isOwner } from "@/pages/aprobaciones/model";
import { createMcpClient, revokeMcpClient, rotateMcpClient } from "@/pages/ajustes/conectores/api";
import {
  TOOL_SCOPES,
  asClient,
  clientName,
  clientStatus,
  codeFromName,
  isGrantableScope,
  mcpCalls,
  mcpEndpoint,
  personName,
  scopeLabel,
  uniqueClients,
  validateDraft,
  type AuditItem,
  type ClientStatus,
  type McpClient,
  type Person,
} from "@/pages/ajustes/conectores/model";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  GlassMenu,
  InfoTip,
  Input,
  MenuItem,
  Select,
  Skeleton,
  useMenuOpen,
  useToast,
} from "@/ui";

type AuditPage = { items: AuditItem[] };

/** The raw token lives only in this dialog state and is dropped on close. */
type Mode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "token"; variant: "created" | "rotated"; name: string; token: string }
  | { kind: "revoke"; id: string };

const STATUS_TONE: Record<ClientStatus, "success" | "neutral" | "warning"> = {
  active: "success",
  revoked: "neutral",
  expired: "warning",
};

export function ConnectorsPanel({ me }: { me: Me }) {
  const toast = useToast();
  const owner = isOwner(me);
  const clients = useApi<{ items: unknown[] }>(owner ? "/v1/mcp/clients" : null);
  const calls = useApi<AuditPage>(owner ? "/v1/audit?table=mcp.call&limit=50" : null);
  const directory = useApi<{ items: { id: string; display_name: string; status: string }[] }>(owner ? "/v1/users" : null);
  const [mode, setMode] = useState<Mode>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const endpoint = mcpEndpoint();

  if (!owner) return <NoPermission />;

  const items = uniqueClients((clients.data?.items ?? []).map(asClient).filter((item): item is McpClient => item !== null));
  const people = (directory.data?.items ?? [])
    .filter((person) => person.status === "active" && person.display_name.trim().length > 0)
    .map((person) => ({ id: person.id.toLowerCase(), name: person.display_name.trim() }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
  const recent = calls.data ? mcpCalls(calls.data.items) : null;
  const revoking = mode.kind === "revoke" ? items.find((item) => item.id === mode.id) ?? null : null;

  function closeToken() {
    setMode({ kind: "closed" });
  }

  async function copyText(value: string, ok: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(ok, { tone: "success" });
    } catch {
      toast(copy.connectors.copyFail, { tone: "warning" });
    }
  }

  async function rotate(client: McpClient) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const issued = await rotateMcpClient(client.id);
      if (typeof issued.token !== "string" || issued.token.length === 0) {
        toast(copy.connectors.rotateFail, { tone: "danger" });
        return;
      }
      setMode({ kind: "token", variant: "rotated", name: client.description, token: issued.token });
      clients.reload();
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.connectors.rotateFail, { tone: "danger" });
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  async function confirmRevoke() {
    if (mode.kind !== "revoke" || flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      await revokeMcpClient(mode.id);
      setMode({ kind: "closed" });
      clients.reload();
      toast(copy.connectors.revoked, { tone: "success" });
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.connectors.revokeFail, { tone: "danger" });
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  return (
    <div data-screen="conectores" className="flex flex-col gap-10">
      <section>
        <h2 className="inline-flex items-center gap-1.5 text-label font-medium text-ink-900">
          {copy.connectors.endpoint}
          <InfoTip label={copy.connectors.endpoint}>{copy.connectors.endpointHelp}</InfoTip>
        </h2>
        <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
          <li className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-label font-medium text-ink-900">{copy.connectors.url}</p>
                <p className="mt-0.5 font-mono text-caption break-all text-text-secondary">{endpoint}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={copy.connectors.copyUrl}
                onClick={() => void copyText(endpoint, copy.connectors.urlCopied)}
              >
                <Copy strokeWidth={iconStroke} />
              </Button>
            </div>
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-label font-medium text-ink-900">{copy.connectors.write}</span>
            <span className="text-right text-caption text-text-secondary">{copy.connectors.writeValue}</span>
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-label font-medium text-ink-900">{copy.connectors.limit}</span>
            <span className="text-right text-caption text-text-secondary">{copy.connectors.limitValue}</span>
          </li>
        </ul>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-label font-medium text-ink-900">{copy.connectors.clients}</h2>
          <Button type="button" variant="primary" size="sm" onClick={() => setMode({ kind: "create" })}>
            {copy.connectors.new}
          </Button>
        </div>
        {clients.loading && !clients.data ? (
          <div aria-busy="true" className="mt-3 grid gap-2">
            <p className="sr-only">{copy.loading}</p>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : null}
        {clients.error || (clients.data == null && !clients.loading) ? (
          <div className="mt-3 grid gap-3">
            <Alert tone="danger">{`${copy.error.load} (${clients.error?.code ?? "WC_ERROR"})`}</Alert>
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={clients.reload}>
              {copy.error.retry}
            </Button>
          </div>
        ) : null}
        {clients.data && items.length === 0 ? (
          <div className="mt-3">
            <EmptyState size="sm" title={copy.connectors.empty} description={copy.connectors.emptyHint} />
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
            {items.map((client) => (
              <ClientRow
                key={client.id}
                client={client}
                people={people}
                busy={busy}
                onRotate={() => void rotate(client)}
                onRevoke={() => setMode({ kind: "revoke", id: client.id })}
              />
            ))}
          </ul>
        ) : null}
      </section>

      {recent ? (
        <section data-screen="conectores-llamadas">
          <h2 className="text-label font-medium text-ink-900">{copy.connectors.calls}</h2>
          {recent.length === 0 ? (
            <p className="mt-3 text-caption text-text-tertiary">{copy.connectors.callsEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
              {recent.slice(0, 8).map((call) => {
                const name = clientName(items, call.clientId);
                const meta = [name, formatDateTime(call.at), call.code].filter((part): part is string => Boolean(part));
                return (
                  <li key={call.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-mono text-label break-all text-ink-900">{call.tool}</p>
                      <Badge size="sm" tone={call.ok ? "success" : "danger"}>
                        {call.ok ? copy.connectors.callOk : copy.connectors.callFail}
                      </Badge>
                    </div>
                    {meta.length > 0 ? <p className="mt-0.5 text-caption text-text-tertiary">{meta.join(" · ")}</p> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <CreateDialog
        open={mode.kind === "create"}
        people={people}
        onClose={() => setMode({ kind: "closed" })}
        onCreated={(name, token) => {
          setMode({ kind: "token", variant: "created", name, token });
          clients.reload();
          directory.reload();
        }}
      />
      <TokenDialog
        open={mode.kind === "token"}
        title={mode.kind === "token" && mode.variant === "rotated" ? copy.connectors.tokenNewTitle : copy.connectors.tokenTitle}
        token={mode.kind === "token" ? mode.token : ""}
        onClose={closeToken}
        onCopy={(token) => void copyText(token, copy.connectors.tokenCopied)}
      />
      <Dialog
        open={Boolean(revoking)}
        onClose={() => {
          if (!busy) setMode({ kind: "closed" });
        }}
        size="sm"
        labelledBy="revocar-cliente-title"
      >
        <div data-screen="conectores-revocar">
          <DialogHeader
            title={copy.connectors.revokeTitle}
            titleId="revocar-cliente-title"
            description={fill(copy.connectors.revokeBody, { name: revoking?.description ?? "" })}
            onClose={() => {
              if (!busy) setMode({ kind: "closed" });
            }}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setMode({ kind: "closed" })}>
              {copy.connectors.cancel}
            </Button>
            <Button type="button" variant="danger" size="sm" loading={busy} onClick={() => void confirmRevoke()}>
              {busy ? copy.connectors.revoking : copy.connectors.revoke}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  );
}

function statusLabel(status: ClientStatus): string {
  if (status === "active") return copy.connectors.active;
  if (status === "revoked") return copy.connectors.revokedStatus;
  return copy.connectors.expired;
}

function ClientRow({
  client,
  people,
  busy,
  onRotate,
  onRevoke,
}: {
  client: McpClient;
  people: Person[];
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const menu = useMenuOpen();
  const status = clientStatus(client);
  const person = client.on_behalf_of_display_name ?? personName(people, client.on_behalf_of_user_id);
  const used = client.last_used_at ? formatDateTime(client.last_used_at) : copy.connectors.neverUsed;
  const meta = [
    person ? fill(copy.connectors.behalf, { name: person }) : null,
    `${copy.connectors.lastUse} · ${used}`,
    client.created_at ? fill(copy.connectors.createdAt, { date: formatDate(client.created_at) }) : null,
    client.token_prefix ? fill(copy.connectors.prefix, { prefix: client.token_prefix }) : null,
  ].filter((part): part is string => Boolean(part));
  const scopes = client.scopes.map(scopeLabel).join(" · ");

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label font-medium break-words text-ink-900">{client.description}</p>
            <Badge size="sm" tone={STATUS_TONE[status]}>
              {statusLabel(status)}
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-caption text-text-tertiary">{client.code}</p>
          {scopes ? <p className="mt-1 text-pretty text-caption text-text-secondary">{scopes}</p> : null}
          {meta.length > 0 ? <p className="mt-0.5 text-pretty text-caption text-text-tertiary">{meta.join(" · ")}</p> : null}
        </div>
        {status === "revoked" ? null : (
          <GlassMenu
            open={menu.open}
            onOpenChange={menu.setOpen}
            placement="bottom-end"
            trigger={
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={copy.connectors.more} onClick={menu.toggle}>
                <MoreVertical strokeWidth={iconStroke} />
              </Button>
            }
          >
            <MenuItem
              disabled={busy}
              onClick={() => {
                menu.close();
                onRotate();
              }}
            >
              {copy.connectors.rotate}
            </MenuItem>
            <MenuItem
              tone="danger"
              disabled={busy}
              onClick={() => {
                menu.close();
                onRevoke();
              }}
            >
              {copy.connectors.revoke}
            </MenuItem>
          </GlassMenu>
        )}
      </div>
    </li>
  );
}

function CreateDialog({
  open,
  people,
  onClose,
  onCreated,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
  onCreated: (name: string, token: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [behalf, setBehalf] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const flight = useRef(false);

  function reset() {
    setName("");
    setCode("");
    setCodeEdited(false);
    setSelected(new Set());
    setBehalf("");
    setFields({});
    setBanner(null);
  }

  function close() {
    if (saving || flight.current) return;
    reset();
    onClose();
  }

  async function submit() {
    if (flight.current) return;
    const scopes = TOOL_SCOPES.filter((scope) => selected.has(scope) && isGrantableScope(scope));
    const problems = validateDraft({ name, code, scopes, behalf });
    setFields(problems);
    setBanner(null);
    if (Object.keys(problems).length > 0) return;
    flight.current = true;
    setSaving(true);
    try {
      const issued = await createMcpClient({
        code: code.trim(),
        description: name.trim(),
        scopes: [...scopes],
        on_behalf_of_user_id: behalf === "" ? null : behalf,
      });
      const label = issued.client.description;
      const token = issued.token;
      reset();
      onCreated(label, token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.fields && Object.keys(error.fields).length > 0) {
        setFields(error.fields);
      } else {
        setBanner(error instanceof ApiError ? error.message : copy.connectors.createFail);
      }
    } finally {
      flight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} size="lg" labelledBy="nuevo-cliente-title">
      <DialogHeader title={copy.connectors.new} titleId="nuevo-cliente-title" onClose={close} />
      <DialogBody>
        <form
          id="nuevo-cliente"
          data-screen="conectores-nuevo"
          autoComplete="off"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="mcp-name">
              {copy.connectors.name}
              <Input
                id="mcp-name"
                value={name}
                maxLength={200}
                invalid={Boolean(fields.description)}
                autoComplete="off"
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!codeEdited) setCode(codeFromName(next));
                }}
              />
              {fields.description ? (
                <span role="alert" className="text-caption font-normal text-danger-600">
                  {fields.description}
                </span>
              ) : null}
            </label>
            <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="mcp-code">
              {copy.connectors.code}
              <Input
                id="mcp-code"
                value={code}
                maxLength={41}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                invalid={Boolean(fields.code)}
                onChange={(event) => {
                  setCodeEdited(true);
                  setCode(event.target.value.toLowerCase());
                }}
              />
              {fields.code ? (
                <span role="alert" className="text-caption font-normal text-danger-600">
                  {fields.code}
                </span>
              ) : null}
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-label font-medium text-ink-900">{copy.connectors.scopes}</legend>
            <ul className="grid overflow-hidden rounded-2xl border border-border-subtle sm:grid-cols-2 sm:gap-px sm:bg-border-subtle">
              {TOOL_SCOPES.filter(isGrantableScope).map((scope) => (
                <li key={scope} className="border-b border-border-subtle bg-surface px-4 py-3 last:border-b-0 sm:border-b-0">
                  <Checkbox
                    checked={selected.has(scope)}
                    label={scopeLabel(scope)}
                    description={scope}
                    onChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(scope);
                        else next.delete(scope);
                        return next;
                      });
                    }}
                  />
                </li>
              ))}
            </ul>
            {fields.scopes ? (
              <p role="alert" className="text-caption text-danger-600">
                {fields.scopes}
              </p>
            ) : null}
          </fieldset>
          <label className="grid gap-1.5 text-label font-medium text-ink-900" htmlFor="mcp-person">
            {copy.connectors.person}
            <Select id="mcp-person" className="w-full" value={behalf} onChange={(event) => setBehalf(event.target.value)}>
              <option value="">{copy.connectors.nobody}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
            {fields.on_behalf_of_user_id ? (
              <span role="alert" className="text-caption font-normal text-danger-600">
                {fields.on_behalf_of_user_id}
              </span>
            ) : null}
          </label>
          {banner ? <Alert tone="danger">{banner}</Alert> : null}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={close}>
          {copy.connectors.cancel}
        </Button>
        <Button type="submit" form="nuevo-cliente" variant="primary" size="sm" loading={saving}>
          {saving ? copy.connectors.creating : copy.connectors.create}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function TokenDialog({
  open,
  title,
  token,
  onClose,
  onCopy,
}: {
  open: boolean;
  title: string;
  token: string;
  onClose: () => void;
  onCopy: (token: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="token-cliente-title">
      <div data-screen="conectores-token">
        <DialogHeader title={title} titleId="token-cliente-title" onClose={onClose} />
        <DialogBody>
          <Alert tone="warning">{copy.connectors.tokenWarn}</Alert>
          {token ? (
            <p
              data-secret="token"
              translate="no"
              spellCheck={false}
              className="mt-3 font-mono text-caption break-all text-ink-900 select-all"
            >
              {token}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {copy.connectors.done}
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={token.length === 0} onClick={() => onCopy(token)}>
            {copy.connectors.copyToken}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
