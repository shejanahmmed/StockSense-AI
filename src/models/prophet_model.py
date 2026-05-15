import pandas as pd
from prophet import Prophet

class DemandProphetModel:
    def __init__(self, **kwargs):
        """
        Initialize the Prophet model with custom hyperparameters.
        """
        self.model = Prophet(**kwargs)
        # Add regressors if needed
        self.model.add_regressor('promo')
        self.model.add_regressor('holiday')

    def preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Rename columns for Prophet ('ds' for date and 'y' for target).
        """
        df_p = df.copy()
        if 'date' in df_p.columns:
            df_p = df_p.rename(columns={'date': 'ds'})
        if 'sales' in df_p.columns:
            df_p = df_p.rename(columns={'sales': 'y'})
        return df_p

    def train(self, df: pd.DataFrame):
        """
        Train the model on historical data.
        """
        df_p = self.preprocess(df)
        self.model.fit(df_p)

    def predict(self, future_df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate forecast. future_df must contain 'date' (or 'ds'), 'promo', and 'holiday'.
        """
        df_p = self.preprocess(future_df)
        forecast = self.model.predict(df_p)
        return forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']]
