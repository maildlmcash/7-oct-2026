# Role matrix

Task 1.B.3. Truth label: MOCK. This page is the navigation projection of the role baseline. It does not add a catalog grant. The shipped capability ceiling stays empty. `role scope denied` is the only denial sentence on a disabled action.

Open screens are existing shell sections. DEX, Wallets, Predictions, Search, and Bugs are not open for these roles. Wallets are not an action.

| Role | Open screens | Disabled explanation |
| --- | --- | --- |
| Super Admin | Dashboard, Checklist, Admin | Read exchange secrets. Impersonate user. Override audit trail. |
| Admin | Dashboard, Checklist, Admin | Open another tenant. Assign a higher role. |
| Super Distributor | Dashboard | Change global policy. Open another tenant. |
| Distributor | Dashboard | Create a Super Distributor. Change global rates. |
| Retailer | Dashboard, Paper | Create a distributor role. View another retailer. |
| Customer | Dashboard, Market, Paper, Checklist | Edit provider registry. Edit roles. Edit commissions. |
| Retailer and Customer | Dashboard, Market, Paper, Checklist | The Retailer and Customer rows together. An explicit screen deny removes that screen and shows it disabled. |

Retailer and Customer is two roles on one session, not a seventh role. A preview is available only when the server session is Super Admin. The preview does not change the signed-in role and does not set impersonation. The action API ignores a preview field.

The published shell has no identity session. `POST /api/navigation/action` then returns `login denied`. Desk User and Admin cookies are not this session.
