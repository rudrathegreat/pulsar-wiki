# TEMPO2

**Summary**: The international standard software for high-precision pulsar timing, designed to provide a plug-in based architecture for relativistic timing analysis.

**Sources**: [[tempo2_manual.pdf]], [[stac3719.pdf]]

**Last updated**: 2026-04-27

---

TEMPO2 is a comprehensive tool used to transform observatory-based pulse arrival times into a consistent physical framework. It is the successor to the original Fortran-based TEMPO (source: tempo2_manual.pdf).

## Technical Architecture
- **Language**: Written primarily in C++.
- **Precision**: Uses "long double" precision (80 or 128-bit) for all critical internal calculations. This is necessary because the required timing precision (nanoseconds) is over 15 orders of magnitude smaller than the total travel time from the pulsar (source: tempo2_manual.pdf).
- **Plug-in System**: TEMPO2 is modular. Users can write C++ plug-ins to extend its functionality without modifying the core code.

## Key Plug-ins
- **`plk`**: A graphical interface used to visualize timing residuals across different axes (e.g., time, frequency, orbital phase).
- **`fake`**: A simulation tool used to generate synthetic TOAs based on a given parameter file. This is crucial for testing the sensitivity of new timing models (source: tempo2_manual.pdf).
- **`general2`**: A flexible output formatter used to extract specific timing parameters for further analysis.
- **`stridefit`**: Used to perform fits over specific time "windows" to monitor changes in parameters like [[dispersion-measure]] (source: stac3719.pdf).

## Mathematical Framework
TEMPO2 implements the IAU 2000 resolutions for time scales and coordinate systems. It performs a rigorous transformation from the observatory's local clock (e.g., UTC at [[meerkat]]) to Barycentric Coordinate Time (TCB) at the Solar System Barycenter (source: tempo2_manual.pdf).

## Related pages

- [[pulsar-timing]]
- [[pulsar-timing-array]]
- [[meerkat]]
- [[radio-telescope]]
