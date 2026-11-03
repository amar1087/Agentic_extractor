import { Decimal } from 'decimal.js';
import { Invoice } from './schema.js';

export type ValidationError = { rule: number; field: string; message: string };

export const ISO_4217 = [
    'USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD',
    'CHF', 'CNY', 'SGD', 'AED', 'SAR', 'MXN', 'BRL', 'NZD', 'ZAR', 'SEK', 'NOK', 'DKK', 'HKD',
];

// Money compares at 2dp — LLMs and invoices both round line totals to cents.
const eq2 = (a: Decimal, b: Decimal) => a.toDecimalPlaces(2).equals(b.toDecimalPlaces(2));

// Pure financial rules (SRS 5.2). Rule 3 — invoice ID uniqueness — needs the
// database and is enforced in the VERIFY node.
export function validateInvoice(invoice: Invoice, now = new Date()): ValidationError[] {
    const errors: ValidationError[] = [];

    // Rule 1: Line items must sum to subtotal
    const lineSum = invoice.items.reduce(
        (acc, item) => acc.plus(new Decimal(item.total)),
        new Decimal(0)
    );
    const subtotal = new Decimal(invoice.totals.subtotal);
    if (!eq2(lineSum, subtotal)) {
        errors.push({
            rule: 1, field: 'totals.subtotal',
            message: `Line items sum (${lineSum.toFixed(2)}) does not match subtotal (${subtotal.toFixed(2)})`,
        });
    }

    // Rule 1b: Each line total must equal quantity × unit price
    invoice.items.forEach((item, index) => {
        const expected = new Decimal(item.quantity).times(item.unitPrice);
        if (!eq2(expected, new Decimal(item.total))) {
            errors.push({
                rule: 1, field: `items.${index}.total`,
                message: `Item ${index + 1} ("${item.description}"): ${item.quantity} × ${item.unitPrice} = ${expected.toFixed(2)}, but line total is ${new Decimal(item.total).toFixed(2)}`,
            });
        }
    });

    // Rule 2: Subtotal + Tax = Grand Total
    const computed = subtotal.plus(invoice.totals.tax);
    const grandTotal = new Decimal(invoice.totals.grandTotal);
    if (!eq2(computed, grandTotal)) {
        errors.push({
            rule: 2, field: 'totals.grandTotal',
            message: `Subtotal + tax = ${computed.toFixed(2)}, but grand total is ${grandTotal.toFixed(2)}`,
        });
    }

    // Rule 4: Issue date not in the future, not older than 2 years
    const issueDate = new Date(`${invoice.invoiceMeta.issueDate}T00:00:00Z`);
    const endOfToday = new Date(now);
    endOfToday.setUTCHours(23, 59, 59, 999);
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
    if (Number.isNaN(issueDate.getTime())) {
        errors.push({ rule: 4, field: 'invoiceMeta.issueDate', message: `Issue date "${invoice.invoiceMeta.issueDate}" is not a real date` });
    } else if (issueDate > endOfToday) {
        errors.push({ rule: 4, field: 'invoiceMeta.issueDate', message: `Issue date ${invoice.invoiceMeta.issueDate} is in the future` });
    } else if (issueDate < twoYearsAgo) {
        errors.push({ rule: 4, field: 'invoiceMeta.issueDate', message: `Issue date ${invoice.invoiceMeta.issueDate} is older than 2 years` });
    }

    // Rule 5: Currency must be a valid ISO 4217 code
    if (!ISO_4217.includes(invoice.invoiceMeta.currency)) {
        errors.push({
            rule: 5, field: 'invoiceMeta.currency',
            message: `Currency "${invoice.invoiceMeta.currency}" is not a supported ISO 4217 code`,
        });
    }

    return errors;
}
