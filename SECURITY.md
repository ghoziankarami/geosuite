# Security policy

GeoSuite processes geological files locally by default. The app checks a public
update file; optional Google Drive opening and satellite basemap tiles use
external services only when selected. See the [privacy policy](https://geosuite.orebit.id/privacy/)
for what connects to the network and what is stored locally. The main risks are
malicious input files (script injection through a CSV or project file) and the
Desktop wrapper.

**Report vulnerabilities privately** to support@orebit.id with the subject
"GeoSuite security", or through GitHub's *Report a vulnerability* (Security tab).
Please do not open a public issue for a vulnerability. You will get a reply within
7 days; fixes are released as a patch version and credited unless you prefer not.

Supported: the latest release only.
