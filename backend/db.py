import os
import asyncmy
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MYSQL_HOST = os.environ['MYSQL_HOST']
MYSQL_PORT = int(os.environ.get('MYSQL_PORT', 3306))
MYSQL_USER = os.environ['MYSQL_USER']
MYSQL_PASSWORD = os.environ['MYSQL_PASSWORD']
MYSQL_DATABASE = os.environ['MYSQL_DATABASE']

_pool: Optional[asyncmy.pool.Pool] = None


async def init_db_pool():
    global _pool
    _pool = await asyncmy.create_pool(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        db=MYSQL_DATABASE,
        minsize=1,
        maxsize=10,
        autocommit=True,
        charset='utf8mb4',
    )


async def close_db_pool():
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


@asynccontextmanager
async def get_conn():
    if _pool is None:
        await init_db_pool()
    async with _pool.acquire() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            yield cur


async def fetch_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    async with get_conn() as cur:
        await cur.execute(query, params)
        return await cur.fetchone()


async def fetch_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    async with get_conn() as cur:
        await cur.execute(query, params)
        return await cur.fetchall()


async def execute(query: str, params: tuple = ()) -> int:
    async with get_conn() as cur:
        await cur.execute(query, params)
        return cur.lastrowid


async def execute_many(query: str, params_list: List[tuple]) -> None:
    async with get_conn() as cur:
        await cur.executemany(query, params_list)


async def transaction(queries: List[tuple]) -> None:
    """Execute multiple queries in a transaction.
    queries: list of (query, params) tuples
    """
    if _pool is None:
        await init_db_pool()
    async with _pool.acquire() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await conn.begin()
            try:
                for query, params in queries:
                    await cur.execute(query, params)
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise