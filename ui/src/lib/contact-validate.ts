import type { ContactInput } from "@/lib/contacts";
import { taxIdError } from "@/lib/tax-id";

export function validateContact(input: ContactInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.legal_name.trim();
  if (name.length < 2 || name.length > 200) {
    errors.legal_name = "El nombre fiscal tiene que tener entre 2 y 200 caracteres.";
  }
  const tax = taxIdError(input.tax_id ?? "", input.country_code);
  if (tax) errors.tax_id = tax;
  if (!input.country_code) errors.country_code = "Elige un país.";
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "El correo no es válido.";
  if (!Number.isFinite(input.payment_terms_days) || input.payment_terms_days < 0 || input.payment_terms_days > 365) {
    errors.payment_terms_days = "Los días de pago tienen que estar entre 0 y 365.";
  }
  return errors;
}
