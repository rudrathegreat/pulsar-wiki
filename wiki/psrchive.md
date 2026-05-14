# PSRCHIVE

**Summary**: An open-source, object-oriented software library for pulsar data analysis, used for calibration, RFI mitigation, and pulse profile analysis.

**Sources**: [[psrchive.pdf]], [[tempo2_manual.pdf]]

**Last updated**: 2026-04-27

---

PSRCHIVE is a comprehensive suite of tools designed to process pulsar data stored in the **PSRFITS** format. It is an essential component of the pulsar research pipeline, typically used before [[pulsar-timing]] analysis (source: psrchive.pdf).

## Core Applications
The functionality of PSRCHIVE is divided across several specialized command-line programs:

- **`psredit`**: Used to query or modify the metadata (attributes) of pulsar data files, such as the source name, frequency, and observatory coordinates.
- **`psrstat`**: Derives statistical quantities from pulse profiles, including signal-to-noise ratio (S/N), pulse width, and degree of polarization.
- **`psrplot`**: A highly configurable tool for producing publication-quality diagnostic plots of profiles, dynamic spectra, and polarization.
- **`pat` (Pulsar Arrival Times)**: The primary tool for estimating the time of arrival (TOA) of pulses. It uses template matching to compare observed profiles with a noise-free standard (source: psrchive.pdf).
- **`psrsh`**: A command language interpreter used for batch processing and as a job preprocessor.

## Data Processing Workflow
1.  **RFI Mitigation**: Interference from terrestrial sources is removed using tools like `psrzap` (interactive) or algorithms like `zap median`.
2.  **Calibration**: Correcting for instrumental effects, especially in polarization measurements. PSRCHIVE supports rigorous **Polarimetric Calibration** to recover the true Stokes parameters.
3.  **Integration**: Multiple pulses are integrated (added together) in time or frequency to increase the S/N.
4.  **TOA Estimation**: `pat` is used to generate the `.tim` files required for analysis in [[tempo2]] (source: psrchive.pdf).

## Advanced Features
- **RFI Excision**: Automatic detection and removal of corrupted frequency channels or time sub-integrations.
- **Wavelet Smoothing**: `psrsmooth` uses wavelet-based denoising to create high-quality profile templates.
- **Principal Component Analysis**: `psrpca` can be used to correct for profile variations that introduce bias into timing measurements.

## Related pages

- [[tempo2]]
- [[pulsar-timing]]
- [[radio-telescope]]
- [[radio-pulsar]]
