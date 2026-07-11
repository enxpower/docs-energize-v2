# OWNER INTENT

## Product Purpose

Mining Sim is intended to become an engineering decision-support platform for mine electrification, microgrids, hybrid power systems, and energy infrastructure configuration.

It must help users answer five practical questions:

1. Is the current system configuration technically viable?
2. Which equipment should be added, removed, resized, or reconfigured?
3. How should EMS and local controllers operate the configured assets?
4. Which configuration best balances reliability, cost, fuel reduction, renewable utilization, and expandability?
5. What additional engineering studies are required before final design and construction?

## Primary Use Cases

- Quick Assessment
- Diagnostic Study
- Pre-FEED support
- BESS MW/MWh screening
- diesel reduction studies
- mine electrification infrastructure planning
- charging infrastructure planning
- microgrid operating strategy development
- EPC proposal support
- equipment configuration comparison
- O&M performance analysis
- expansion planning

## Product Direction

The product must evolve from a visual simulator into a configurable engineering platform with four durable assets:

1. Equipment Library
2. Scenario Library
3. Control Strategy Library
4. Engineering Rule Library

## Configuration-Driven Philosophy

The user should be able to adjust system configuration and control strategy, run simulations, observe consequences, receive traceable engineering findings, and iteratively converge toward a better configuration.

The intended loop is:

`Scenario → Configuration → Control Strategy → Simulation → KPI & Risk → Recommendation → Revised Configuration → Comparison`

This loop mirrors real-world EMS engineering and mine electrification planning.

## Supported System Contexts

The architecture must support, without rewriting the core:

- off-grid mines;
- grid-connected mines;
- islandable microgrids;
- diesel-heavy systems;
- PV-heavy systems;
- wind-heavy systems;
- PV + wind + BESS hybrids;
- coastal environments;
- desert environments;
- tropical environments;
- high-altitude environments;
- cold climates;
- mines, ports, processing plants, and smelter-related infrastructure.

## Product Standard

The system must be useful, technically honest, explainable, reproducible, and progressively improvable.

It must never create false engineering confidence.

The goal is not to imitate ETAP, PSCAD, PowerFactory, or OEM controller validation. The goal is to provide a rigorous pre-engineering and decision-support layer that identifies viable configurations, exposes risks, and guides the next engineering step.
