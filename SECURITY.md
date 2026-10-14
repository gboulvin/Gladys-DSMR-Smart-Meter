# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- the P1 reader used (model, TCP or HTTP connection) and the country of the
  meter;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords, decryption keys, meter
  serial numbers and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes — in
particular the parsing of the telegrams received from the network and the
handling of the Luxembourg decryption key, which is stored as a secret and
never logged.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the P1 readers (dongles, HomeWizard, ser2net) and their firmware, and the
smart meters. Note that the P1 port and most P1 readers have no
authentication: keep them on a trusted local network.
