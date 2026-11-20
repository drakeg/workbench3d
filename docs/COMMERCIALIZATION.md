# Workbench3D — SMB commercialization experiments

**Status:** hypotheses only; no verified customer interviews, sales, revenue, or willingness-to-pay data.

## First customer segment

Small woodworking/cabinet shops (owner-operators and small teams) that need dimensioned 3D part layouts and usable cut lists without a complex CAD license or lengthy training. Other possible segments (RV outfitters and light metal fabricators) stay secondary until demand is tested.

**Problem hypothesis:** manual sketching, material planning, and re-entering part dimensions cost shop time and cause avoidable cutting mistakes.

**Value proposition:** a lightweight, locally usable push/pull modeler with precise measurements, reusable components, plywood/stock layouts and printable cut plans. The primary product is the **tested shop workflow**, not the number of modeling features.

## MVP and demonstration

Demo an end-to-end cabinet job: create a 24-inch cabinet; assign plywood material; generate a bill of parts with dimensions; arrange parts on 4×8 sheets with kerf; export/print the cut plan; save and reopen the project without losses. Keep a sample `.wb3d` file and repeatable instructions for acceptance. Test the browser and desktop builds.

A prospective customer should be able to complete this workflow without developer intervention. Record elapsed time, missing steps, incorrect outputs, usability issues and software crashes. Treat critical dimension or cut-plan errors as P0/P1.

## Market and price hypotheses

Competing approaches include SketchUp, Fusion, FreeCAD, spreadsheet cut lists, dedicated nesting/cut-list tools, and hand-drawn plans. These are categories to investigate, **not proof** of competitive pricing or unmet demand.

Keep the core open source under MIT. Explore optional paid services only after validation: onboarding and custom shop templates, supported deployment/training, or workflow-specific add-ons. **Illustrative pricing hypotheses to test** (not approved prices): $99–$299 one-time workshop onboarding or $15–$39/month for an optional managed team workflow. No paywall or paid infrastructure until the maintainer approves.

## Validation funnel and evidence

1. Demonstrate the cabinet job with at least five independently recruited shop operators; collect observed failures, not just praise.
2. Ask each person what tool they use today, typical time/cost of drafting and material estimation, and what they would actually pay for a repeatable service.
3. Offer two low-risk pilots and request explicit approval to proceed before installing at a customer site or handling their files.
4. Measure pilot completion, time saved relative to the operator's actual current method, errors and expressed purchase intent. Separate estimated savings from measured savings.
5. Convert a pilot to a paid engagement only with agreed price and scope; otherwise revise or deprioritize the offer.

Do not invent interviews, outcomes or revenue. Avoid collecting customer project files unless needed and authorized.

## Product-oriented backlog choices

- **Highest:** correctness of dimensions, cut list, print layout, project file compatibility and error handling.
- **Next:** faster first-run workflow, sample cabinet templates and a demonstrable printable estimate.
- **Later:** novel modeling tools and secondary-industry templates unless a pilot requires them.

Review these hypotheses during sprint planning and update them with documented evidence.
