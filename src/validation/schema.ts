import { z } from 'zod';

// Optional fields use .nullish(): the extraction prompt (and JSON-schema
// constrained decoding) lets the model emit null for absent values, and
// .optional() alone would reject those valid responses.
export const InvoiceSchema = z.object({
    vendor: z.object({
        name: z.string().min(1),
        taxId: z.string().nullish(),
        address: z.string().nullish(),
        email: z.string().email().nullish().or(z.literal('').transform(() => null)),
    }),
    invoiceMeta: z.object({
        invoiceId: z.string().min(1),
        issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        currency: z.string().length(3).default('USD'),
    }),
    items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        total: z.number().nonnegative(),
    })).min(1),
    totals: z.object({
        subtotal: z.number().nonnegative(),
        tax: z.number().nonnegative(),
        grandTotal: z.number().positive(),
    }),
});

export type Invoice = z.infer<typeof InvoiceSchema>;

// JSON schema handed to the model for constrained decoding. Hand-written rather
// than z.toJSONSchema(): grammar engines (Ollama, vLLM) cope badly with
// pattern/format/nested anyOf, and every key is required so the model can
// never silently drop one — absent values come back as null.
const str = { type: 'string' };
const num = { type: 'number' };
const nullableStr = { type: ['string', 'null'] };
const obj = (properties: Record<string, unknown>) => ({
    type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

export const InvoiceJSONSchema: Record<string, unknown> = obj({
    vendor: obj({ name: str, taxId: nullableStr, address: nullableStr, email: nullableStr }),
    invoiceMeta: obj({
        invoiceId: str,
        issueDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
        currency: { type: 'string', description: 'ISO 4217 code, e.g. USD' },
    }),
    items: { type: 'array', minItems: 1, items: obj({ description: str, quantity: num, unitPrice: num, total: num }) },
    totals: obj({ subtotal: num, tax: num, grandTotal: num }),
});
