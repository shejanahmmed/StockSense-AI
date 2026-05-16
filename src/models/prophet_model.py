import pandas as pd
from prophet import Prophet
import json
from prophet.serialize import model_to_json, model_from_json
from pathlib import Path

class DemandProphetModel:
    def __init__(self, **kwargs):
        """
        Initialize the Prophet model with custom hyperparameters.
        """
        self.model = Prophet(**kwargs)
        self.regressors_added = False

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
        
        # Dynamically add all extra numeric columns as regressors
        if not self.regressors_added:
            for col in df_p.columns:
                if col not in ['ds', 'y'] and pd.api.types.is_numeric_dtype(df_p[col]):
                    self.model.add_regressor(col)
            self.regressors_added = True
            
        self.model.fit(df_p.dropna())

    def predict(self, future_df: pd.DataFrame) -> pd.DataFrame:
        """
        Generate forecast. future_df must contain 'date' (or 'ds') and any added regressors.
        """
        df_p = self.preprocess(future_df)
        forecast = self.model.predict(df_p)
        return forecast

    def save(self, filepath: str | Path):
        """Save the trained model to disk as JSON."""
        with open(filepath, 'w') as fout:
            json.dump(model_to_json(self.model), fout)

    @classmethod
    def load(cls, filepath: str | Path):
        """Load a trained model from disk JSON."""
        with open(filepath, 'r') as fin:
            model_dict = json.load(fin)
            prophet_model = model_from_json(model_dict)
            
        instance = cls()
        instance.model = prophet_model
        instance.regressors_added = True
        return instance
