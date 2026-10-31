import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";

export function explainStockError(error: ApiError): string {
  if (error.code === "WC021") {
    const until = error.details?.locked_until;
    const date = typeof until === "string" ? formatDate(until) : "";
    if (date && date !== "—") {
      return `El periodo está cerrado hasta el ${date}. No se puede registrar ni cambiar un movimiento con fecha anterior.`;
    }
    return "El periodo está cerrado. Ese movimiento queda solo para consulta y no se puede cambiar.";
  }
  if (error.code === "WC024" || error.code === "WC027") {
    const lot = error.details?.lot_code;
    const which = typeof lot === "string" && lot ? ` de ${lot}` : "";
    return `El saldo${which} quedaría en negativo. El libro no admite existir por debajo de cero: revisa los litros o las unidades.`;
  }
  if (error.code === "WC022") {
    return "Los movimientos no se modifican. Para corregir uno, rectifica el documento de origen.";
  }
  if (error.code === "WC025") {
    return "El volumen supera la capacidad del recipiente.";
  }
  if (error.code === "WC023") {
    return "Los litros no cuadran con las unidades del formato.";
  }
  if (error.code === "WC_OPENING_EXISTS") {
    return "Ya existe un aforo de arranque para esa fecha y esa entidad. No se puede repetir.";
  }
  return error.message;
}

export function periodClosedText(lockedUntil: string | null | undefined): string {
  const date = lockedUntil ? formatDate(lockedUntil) : "";
  if (date && date !== "—") {
    return `El periodo está cerrado hasta el ${date}. Esos movimientos se consultan y no se pueden cambiar.`;
  }
  return "El periodo está cerrado. Esos movimientos se consultan y no se pueden cambiar.";
}
