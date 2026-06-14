import sqlite3

def run():
    conn = sqlite3.connect('data/users.db')
    cursor = conn.cursor()
    cursor.execute("UPDATE docs_team SET role = 'Software Engineer' WHERE name = 'Farjan Ahmmed'")
    conn.commit()
    conn.close()
    print("Successfully updated Farjan Ahmmed's role to Software Engineer in the database.")

if __name__ == '__main__':
    run()
