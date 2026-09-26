---
name: fintech-ui
description: Design, implement, and review trustworthy, responsive personal finance or fintech interfaces. Use for dashboards, account balances, transaction lists, spending breakdowns, and transaction forms in frontend projects, including MoneyFlow; follow the product's PRD for features and scope.
---

# Fintech UI

Build a calm, readable financial interface that helps a person verify amounts and understand where money moved. Follow the project's PRD for product logic, data, implementation phases, and technology. Apply this skill to presentation and interaction design; do not add features or persistence beyond the requested phase.

For MoneyFlow, read [references/moneyflow-visuals.md](references/moneyflow-visuals.md) and inspect its four image assets before designing the dashboard. The reference is design guidance; the PRD remains authoritative for scope and calculations.

## Before coding

1. Identify the primary user question on the page and make its answer visible without scrolling on a typical desktop screen.
2. Decide the information hierarchy: period and primary action, key totals, accounts or category breakdown, transactions, then secondary details. Adapt it to the actual task rather than forcing a fixed layout.
3. Use the project's real data model and constraints. Do not invent bank connectivity, live market data, or security assurances for a mock product.

## Visual language

- Choose one deliberate visual direction and keep it consistent: restrained palette, readable type, generous spacing, clear alignment, subtle borders. A light or dark theme can work. Do not default to generic neon gradients, glowing charts, decorative blobs, or a grid of identical cards.
- Make monetary values prominent. Use a clear type scale and distinguish labels, primary figures, helper text, and metadata. Put related values on a common baseline where possible.
- Keep surfaces purposeful. Prefer a compact summary, well-spaced rows and simple sections to excessive nesting and card chrome.
- Use positive, negative, and neutral color consistently, with explicit `Income`/`Expense` text or signs so meaning survives without color. Preserve sufficient contrast in text, controls, charts, and focus states.
- Avoid decorative charts. Category comparisons must show a label and exact amount; if bars or a chart are used, scale them honestly and make the meaning clear without relying on a tooltip.

## Financial data display

- Format currency and dates consistently for the PRD's locale. Align amounts; show separators and two decimal places. Keep signs and labels unambiguous. Do not present a rounded display value as if it were an exact total.
- Display the reporting period and, where relevant, whether data is demo or live. Distinguish flow over a period (income, expenses, net) from balance at a point in time.
- In transaction lists, make description, date, account, category, type and amount easy to scan. On mobile, prioritize description and amount, then place secondary metadata on a second line. Prevent horizontal overflow.
- When a value changes, update every visible aggregate based on the same data source. Avoid hard-coded totals in the rendered view. Use integer minor units for money when the product does not already specify a safe money representation.

## Interaction and responsive behavior

- Give every action an obvious result. Form fields need persistent labels, useful validation messages, sensible defaults, visible keyboard focus, and adequate touch targets. A dialog should have a clear heading, close/Cancel action, and Escape behavior.
- Make narrow screens a designed layout, not a squeezed desktop. Stack summaries thoughtfully, keep the main action discoverable, and let long descriptions wrap without clipping currency amounts.
- Use semantic elements and accessible names. Do not make an inert tab, filter, menu, or chart control look interactive. When a feature is out of scope, omit its control.
- Handle empty and long-content states where they can occur in the current product; do not fabricate complex error states for APIs that do not exist.

## Review loop

1. Run the app and inspect the rendered page at a wide and a narrow viewport when browser preview is available; otherwise inspect the built output and report the visual check still needed.
2. Check numerical consistency, reading order, contrast, overflow, forms, and keyboard use. Compare with the PRD's acceptance examples.
3. Name the most consequential issues concretely. If asked to review only, stop before editing; if asked to improve, fix the requested issues and verify again.
4. Finish with a concise summary of changes and checks. Keep feature requests separate from design fixes.
