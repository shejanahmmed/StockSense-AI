import os
import logging
from pathlib import Path
import pandas as pd
import duckdb

logger = logging.getLogger(__name__)

# Resolve local lakehouse storage path
project_root = Path(__file__).resolve().parent.parent.parent
LAKEHOUSE_DIR = project_root / "data" / "lakehouse"

def get_parquet_path(org_name: str) -> Path:
    """Returns the absolute path of the Parquet transactions store for an organization."""
    return LAKEHOUSE_DIR / f"{org_name}_transactions.parquet"

def save_to_lakehouse(df: pd.DataFrame, org_name: str) -> bool:
    """
    Exports a sales transaction DataFrame as a persistent, columnar Parquet file.
    Represents our local-first Data Lakehouse storage layer.
    """
    try:
        # Ensure target directory exists
        LAKEHOUSE_DIR.mkdir(parents=True, exist_ok=True)
        parquet_path = get_parquet_path(org_name)
        
        # Save to Parquet using pyarrow/pandas engine
        # We enforce column names to be standardized strings
        df_copy = df.copy()
        df_copy.columns = [str(c).strip().lower().replace(' ', '_') for c in df_copy.columns]
        
        df_copy.to_parquet(str(parquet_path), index=False, engine='pyarrow')
        logger.info(f"Successfully exported {len(df)} transactions to Lakehouse Parquet: {parquet_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to save to Lakehouse Parquet: {e}")
        return False

def query_warehouse(org_name: str, query_str: str, params: list = None) -> list[dict]:
    """
    Executes an analytical OLAP SQL query using DuckDB.
    Reads directly from the organization's Parquet file.
    """
    parquet_path = get_parquet_path(org_name)
    if not parquet_path.exists():
        logger.warning(f"Data warehouse Parquet file not found for '{org_name}': {parquet_path}")
        return []
        
    conn = None
    try:
        # Connect to an in-memory DuckDB instance
        conn = duckdb.connect(database=':memory:')
        
        # Register the parquet file as a view named 'sales_history'
        # This allows writing queries referencing 'sales_history' directly
        conn.execute(f"CREATE VIEW sales_history AS SELECT * FROM read_parquet('{str(parquet_path).replace(os.sep, '/')}')")
        
        # Run query
        if params:
            res = conn.execute(query_str, params)
        else:
            res = conn.execute(query_str)
            
        # Convert columns to lists of dicts
        cols = [desc[0] for desc in res.description]
        rows = res.fetchall()
        
        data = []
        for r in rows:
            data.append(dict(zip(cols, r)))
            
        return data
    except Exception as e:
        logger.error(f"DuckDB query failed on warehouse: {e}")
        return []
    finally:
        if conn:
            conn.close()
