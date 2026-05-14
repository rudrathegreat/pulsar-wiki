# Radio Frequency Interference

**Summary**: Terrestrial or satellite-based signals that contaminate astronomical data, requiring sophisticated mitigation techniques in pulsar research.

**Sources**: [[psrchive.pdf]], [[radio-telescope.md]]

**Last updated**: 2026-04-27

---

Radio Frequency Interference (RFI) is one of the greatest challenges for modern [[radio-telescope]]s. Since pulsars are extremely faint, even weak terrestrial signals (from cell phones, satellites, or spark plugs) can overwhelm the astronomical data (source: psrchive.pdf).

## Types of RFI
1. **Narrow-band**: Signals that affect only a few frequency channels, often from communication devices.
2. **Impulsive**: Brief, broadband bursts of interference, often from electrical machinery or lightning.
3. **Satellite**: Signals from GPS or communication satellites that can affect large portions of the sky.

## Mitigation and Excision
Before [[pulsar-timing]] can be performed, RFI must be identified and removed from the data. Tools like [[psrchive]] provide several methods:
- **`psrzap`**: Allows observers to interactively "mask" corrupted data.
- **Automated Algorithms**: Programs like `zap median` use statistical tests (e.g., median absolute deviation) to detect and zero-out corrupted channels (source: psrchive.pdf).

## The Importance of Radio Quiet Zones
To minimize RFI, major observatories like [[meerkat]] are located in remote areas protected by law as "Radio Quiet Zones."

## Related pages

- [[radio-telescope]]
- [[psrchive]]
- [[pulsar-timing]]
