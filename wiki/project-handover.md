# Project Handover

**Summary**: This project concerns MeerKAT pulsar timing. This guide records the supplied project context and related background on binary and millisecond pulsars for continuation of the work.

**Sources**:
- [[binary-pulsar]] — wiki page
- [[millisecond-pulsar]] — wiki page

**Last updated**: 2026-10-23

---

## Project overview and current state

The project is named **Pulsar timing** and is described as **MeerKAT pulsar timing**. No further project-specific context, target list, observing programme, analysis status, or scientific objective was supplied.

The supplied material provides background relevant to the project:

- Binary pulsars are used to study orbital dynamics, stellar evolution, and relativistic physics. [[binary-pulsar]]
- Pulsar orbital motion produces periodic shifts in pulse arrival times. [[binary-pulsar]]
- Millisecond pulsars (MSPs) are rapidly rotating pulsars with periods below 50 ms and are commonly associated with recycling in binary systems. [[millisecond-pulsar]]
- MSPs are used in pulsar timing arrays because of their rotational stability. [[millisecond-pulsar]]

The current project state is therefore **not established from the supplied evidence**. In particular, there is no documented indication of whether MeerKAT observations have been obtained, reduced, timed, or interpreted. These items need verification.

## Material inventory

### Supplied wiki pages

- **[[binary-pulsar]]**: Background on binary-pulsar companion types, Keplerian and post-Keplerian timing parameters, and recycling. It references [pulsars.md](/#file/pulsars.md), [stac3719.pdf](/#file/stac3719.pdf), and [s41550-019-0880-2 (1).pdf](/#file/s41550-019-0880-2%20%281%29.pdf), but those referenced materials were not supplied in this bundle. [[binary-pulsar]]
- **[[millisecond-pulsar]]**: Background on MSP formation, precision timing, pulsar timing arrays, mass constraints, and selected catalogue entries. It references [pulsars.md](/#file/pulsars.md), [pulsar-info.txt](/#file/pulsar-info.txt), [s41550-019-0880-2 (1).pdf](/#file/s41550-019-0880-2%20%281%29.pdf), and [stac3719.pdf](/#file/stac3719.pdf), none of which were supplied in this bundle. [[millisecond-pulsar]]

### Not supplied

No raw MeerKAT data, observation logs, timing files, pulsar ephemerides, scripts, notebooks, figures, tables, reduction products, or project reports were supplied.

Visual notebook outputs are not supplied; there are also no notebook materials or saved-cell links in the evidence bundle.

## Methods, environment and reproducibility

### Documented scientific methods

The wiki material documents the general timing concepts relevant to the project:

- Keplerian binary parameters include orbital period \(P_b\), eccentricity \(e\), projected semi-major axis \(x\), longitude of periastron \(\omega\), and time of periastron passage \(T_0\). [[binary-pulsar]]
- Post-Keplerian parameters may include Shapiro delay, periastron advance \(\dot{\omega}\), and orbital-period derivative \(\dot{P}_b\). [[binary-pulsar]]
- MSP timing can support studies of correlated timing residuals in pulsar timing arrays and measurements such as Shapiro delay. [[millisecond-pulsar]]

These are background descriptions rather than evidence that the project has used any particular timing model or measured any of these parameters.

### Environment and dependencies

No software environment, package versions, operating system, telescope archive system, timing package, calibration tools, scripts, configuration files, or data formats were supplied.

No commands were recorded in the supplied materials.

Reproducibility is therefore **not currently established**. The following need verification:

- Which MeerKAT observations and data products are in scope.
- Which calibration and reduction workflow was used.
- Which timing software and model were used.
- Package and software versions.
- Input and output file locations.
- Any selection, flagging, folding, template-building, or time-standard conventions.
- Whether clock corrections, dispersion-measure variations, solar-system ephemerides, and instrument-specific corrections were applied.

## Results and interpretation

No project-specific measurements, fitted parameters, residuals, uncertainties, plots, tables, or statistical assessments were supplied.

The following are recorded background observations from the wiki pages, not independently verified project results:

- Binary orbital motion affects pulse arrival times. [[binary-pulsar]]
- MSPs are generally associated with low magnetic fields of \(10^8\)–\(10^9\) G in the described recycling scenario. [[millisecond-pulsar]]
- The wiki identifies PSR J0740+6620 as a \(2.14\,M_{\odot}\) MSP and describes its relevance to dense-matter and equation-of-state studies. [[millisecond-pulsar]]
- The wiki lists J0024-7204aa with a 1.84 ms period and J0023+0923 with a 3.05 ms period. [[millisecond-pulsar]]

These statements are contextual and are not measurements made by the MeerKAT project. The supplied evidence does not support conclusions about the target pulsar population, timing precision, orbital parameters, mass measurements, gravitational-wave sensitivity, or scientific significance of this project.

## Decisions and rationale

No project decisions or rationale were documented.

The supplied background supports considering binary orbital parameters, post-Keplerian effects, and MSP stability when defining a timing analysis, but it does not show that any such choices were made for this project. Any adopted target selection, timing model, observing cadence, data-quality criterion, or interpretation should be recorded and marked as needing verification until supporting project records are located.

## People and ownership

No researchers, maintainers, supervisors, data owners, analysis owners, or contacts were identified.

Ownership of the following remains unknown and needs verification:

- MeerKAT data access and archive permissions.
- Observation and calibration products.
- Timing-analysis scripts and configuration.
- Pulsar ephemerides and timing solutions.
- Scientific interpretation and publication outputs.
- Project documentation and final approval.

## Assumptions and limitations

- The project title and description are taken from the supplied project metadata; no additional project context was provided.
- The two wiki pages are background documentation, not a project log or analysis record.
- Claims attributed to the wiki pages are treated as documented statements from those pages, not independently checked results. [[binary-pulsar]] [[millisecond-pulsar]]
- References listed by the wiki pages were not supplied and cannot be assessed here. [[binary-pulsar]] [[millisecond-pulsar]]
- No raw data or visual outputs were supplied, so data quality, processing choices, plots, and residual behaviour cannot be evaluated.
- No dates, milestones, owners, commands, dependencies, or file paths for the project were documented.
- The relationship between the general binary/MSP background and the specific MeerKAT target or targets is not documented.

## Unresolved questions and risks

1. **Project scope**: Which pulsar or pulsars are being timed, and is the focus binary systems, MSPs, or another population?
2. **Observations**: Which MeerKAT observation dates, receivers, frequency ranges, integration times, and observing modes are relevant?
3. **Data availability**: Where are the raw, calibrated, folded, and extracted timing data?
4. **Processing history**: What calibration, radio-frequency-interference excision, folding, and profile-processing steps have already been performed?
5. **Timing model**: Which timing model and parameter set are being used? It is unknown whether binary or post-Keplerian parameters are included.
6. **Time and reference standards**: Which clock corrections, solar-system ephemeris, time standard, and dispersion treatment were applied?
7. **Validation**: Are there residual plots, goodness-of-fit statistics, parameter covariances, or independent checks?
8. **Reproducibility**: Are scripts, environments, dependency versions, and execution records available?
9. **Scientific objective**: Is the intended outcome a timing solution, orbital characterisation, precision timing campaign, mass constraint, or another result?
10. **Ownership and continuity**: Who can provide the data, analysis products, and scientific decisions?
11. **Source verification**: The wiki cites additional documents that are absent from this bundle, so their claims and applicability to the project remain unverified. [[binary-pulsar]] [[millisecond-pulsar]]

## Prioritised next steps

### Priority 1 — Establish scope and ownership

- Identify the target pulsar(s), project objective, current milestone, and intended deliverable.
- Identify the researcher responsible for the data, analysis, and scientific decisions.
- Locate the project repository, data archive location, observing records, and existing documentation.
- Record which materials are authoritative when project records conflict with the background wiki pages.

### Priority 2 — Recover the analysis chain

- Collect the relevant MeerKAT observation and calibration products.
- Locate scripts, notebooks, timing files, ephemerides, configuration files, and generated products.
- Record the commands used, software packages, versions, operating environment, and data-processing sequence.
- Determine whether any saved results or visual outputs exist; none are present in the supplied bundle.

### Priority 3 — Verify the timing methodology

- Document the timing model and fitted parameters.
- Confirm treatment of binary motion, dispersion, clock corrections, solar-system ephemeris, and instrumental effects.
- Record units, reference epochs, parameter uncertainties, and any fixed versus fitted quantities.
- Check whether the documented analysis is appropriate to the target pulsar class and stated science objective.

### Priority 4 — Validate and document results

- Recover residuals, fit statistics, parameter tables, and figures.
- Compare results with independent observations or prior timing solutions where available.
- Separate measured project results from contextual claims in the wiki pages.
- Record limitations, unresolved anomalies, and the criteria for accepting the timing solution.

## Review record

- [ ] Handover draft reviewed by the incoming researcher

## Related pages

- [[binary-pulsar]]
- [[millisecond-pulsar]]
