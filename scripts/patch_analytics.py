"""
Patch analytics.py to insert data span validation and dynamic forecast horizon
selection immediately after the date parsing line.
"""
import re
from pathlib import Path

path = Path("src/api/routers/analytics.py")
content = path.read_text(encoding="utf-8")

# Normalise line endings for matching
normalised = content.replace("\r\n", "\n")

ANCHOR = "        df['date'] = pd.to_datetime(df['date'])\n\n        # "

REPLACEMENT = """\
        df['date'] = pd.to_datetime(df['date'])

        # -- Data span validation & dynamic forecast horizon ------------------
        date_min       = df['date'].min()
        date_max       = df['date'].max()
        data_span_days = (date_max - date_min).days + 1

        if data_span_days < 30:
            raise HTTPException(
                status_code=422,
                detail={
                    "error":          "INSUFFICIENT_DATA",
                    "data_span_days": data_span_days,
                    "required_days":  30,
                    "message": (
                        f"Your CSV only covers {data_span_days} day(s) of sales history, "
                        f"which is not enough to generate a reliable forecast. "
                        f"Minimum: 90 days -> 7-day forecast | "
                        f"180 days -> 14-day forecast | 360 days -> 30-day forecast."
                    )
                }
            )

        # Select forecast horizon based on how much data the user provided
        if data_span_days >= 360:
            forecast_horizon = 30
            forecast_label   = "30-Day Forecast"
        elif data_span_days >= 180:
            forecast_horizon = 14
            forecast_label   = "14-Day Forecast"
        else:
            forecast_horizon = 7
            forecast_label   = "7-Day Forecast"

        # """

if ANCHOR in normalised:
    patched = normalised.replace(ANCHOR, REPLACEMENT, 1)
    path.write_text(patched, encoding="utf-8")
    print("SUCCESS: Validation block inserted into analytics.py")
else:
    print("ERROR: anchor not found. Showing nearby context:")
    idx = normalised.find("df['date'] = pd.to_datetime")
    print(repr(normalised[max(0, idx-10) : idx+200]))
