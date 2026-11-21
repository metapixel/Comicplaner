# Comic-Planer

Aktuelle Version: **2.1.0**

Monatsplanung für die Comic-Merkliste aus VLB-TIX – mit Import, Dublettenprüfung, Status pro Titel und Änderungsverlauf. Läuft auf jedem normalen Webspace mit PHP und MySQL/MariaDB und lässt sich auf iPhone, iPad und Mac als App installieren (PWA).

## Voraussetzungen

- PHP 8.1 oder neuer (mit PDO MySQL – bei praktisch allen Hostern aktiv)
- MySQL 5.7+ oder MariaDB 10.3+
- HTTPS (empfohlen, für die App-Installation auf dem iPhone nötig)
- Für „+ Titel“: ausgehende HTTPS-Verbindungen vom Webspace (cURL oder allow_url_fopen – bei fast allen Hostern Standard)

## Installation

1. Beim Hoster eine neue Datenbank anlegen und Name, Benutzer und Passwort notieren.
2. Dieses Repository herunterladen (grüner Button „Code“ → „Download ZIP“) und den Inhalt per FTP/SFTP auf den Webspace laden, z. B. nach `https://deine-domain.de/comics/`. Den Ordner `.github` und die Dateien `README.md`, `THIRD-PARTY-NOTICES.md` brauchst du dort nicht.
3. Der Ordner `inc` muss beschreibbar sein (meist automatisch so; sonst per FTP-Programm auf 755 setzen).
4. `https://deine-domain.de/comics/install.php` aufrufen, Datenbankdaten und dein Passwort eintragen.
5. **Danach `install.php` vom Webspace löschen.**
6. Anmelden, auf **Import** klicken und den Excel-Export aus VLB-TIX hineinziehen.

## Als App aufs iPhone/iPad

In Safari die Adresse öffnen → **Teilen** → **Zum Home-Bildschirm**.

## Bedienung

- **Import:** Excel (.xlsx) oder CSV aus VLB-TIX. Vor dem Speichern zeigt eine Vorschau: neue Titel, geänderte Titel (z. B. verschobener Termin, neuer Preis), mögliche Dubletten (gleicher Titel, andere ISBN), doppelte Zeilen in der Datei, unveränderte Titel und Titel, die nicht mehr in der Merkliste stehen. Status und Notizen bleiben bei jedem Import erhalten.
- **Status:** Interessant → Kaufen → Bestellt → Da, oder Verworfen.
- **Monatsansicht:** Summen pro Monat für „Kaufen“ und „Bestellt“. Termine wie „01.2099“ (VLB-Platzhalter) landen unter „Ohne Termin“.
- **Sammlung:** Reiter „Sammlung“ – alle Comics nach Reihen sortiert (A–Z-Sprungleiste), je Band „gelesen/ungelesen“ mit einem Tipp. Reihen lassen sich umbenennen, zusammenführen und als „komplett“ markieren. VLB-Titel ohne eingetragene Reihe werden anhand von Titel und Bandnummer zugeordnet („Lucky Luke 104“ landet bei Lucky Luke). Einträge ohne ISBN (alte Hefte, Sonderausgaben) über „+ Eintrag ohne ISBN“; eine ISBN kann später im Bearbeiten-Dialog nachgetragen werden.
- **Hab ich das?** Die Suche durchsucht immer alles – unabhängig von Filtern, Zeitraum und Ansicht – und zeigt groß „vorhanden“, „bestellt“, „noch kaufen“ oder „Wunschliste“. Umlaute sind egal („hauptlinge“ findet „Häuptlinge“), mehrere Wörter werden alle gesucht („lucky luke 47“).
- **Offline:** Die App merkt sich den letzten Stand auf dem Gerät und funktioniert auch ohne Netz (Suche, Ansehen, gelesen/Status/Notiz ändern). Offline-Änderungen werden übertragen, sobald wieder Verbindung besteht. Bearbeiten, Import und Sicherung brauchen eine Verbindung.
- **Aus Apple Notes übernehmen (Menü ⋯):** Notiz kopieren und einfügen. Überschriften → Reihen, eingerückte Überschriften (Tab) → Unterreihen, Aufzählungspunkte → Bände; eingerückte Punkte unter einem Band (z. B. Inhalt eines Sammelbands) landen in dessen Notiz. `@gelesen`, `@komplett` und `@noch-bestellen` werden ausgewertet, andere `@…` als Tags übernommen, „| Storys: …“ als Notiz. Eine Vorschau zeigt vorher alles; Überschriften ohne Unterpunkte (oft Gruppen wie „Daredevil“) lassen sich abwählen. Eine zweite Übernahme legt nichts doppelt an.
- **Sicherung (Menü ⋯):** „Sicherung herunterladen“ speichert alles (Einträge, Status, Notizen, Verlauf) als JSON-Datei. „Sicherung einspielen“ stellt diesen Stand vollständig wieder her.
- **+ Titel:** Ältere oder vergriffene Comics ohne VLB-Export auf die Liste setzen. Sucht im Katalog der Deutschen Nationalbibliothek nach Titel, Reihe, Autor, Verlag oder ISBN (auch mehrere ISBNs auf einmal). Treffer antippen, Status wählen, hinzufügen. Titel, die schon auf der Liste stehen, sind markiert; ähnliche Titel mit anderer ISBN werden angezeigt. Am iPhone lässt sich die ISBN über „Text scannen“ direkt vom Heft abfotografieren. Ist nur das Erscheinungsjahr bekannt, erscheint der Titel unter „Jahr · ohne Monat“.
- **Statistik:** Reiter „Statistik“ oben links – erwartete Ausgaben pro Monat als gestapelte Balken (Da, Bestellt, Kaufen, optional „Interessant“ als mögliche Ausgaben), Kennzahlen, Tabellenansicht. Verlagsauswahl, Suche und Zeitraum wirken auch hier; Klick auf einen Monat springt in die Liste.
- **Menü (⋯):** CSV-Export der aktuell gefilterten Liste (öffnet sich in Excel/Numbers), Passwort ändern, Abmelden.
- **Titel entfernen:** Titel aufklappen → „Titel entfernen“.

## Mehrere Nutzer

Jeder Nutzer hat seine eigene Sammlung, Planung, Importe und Statistik – die anderen (auch Admins) sehen davon nichts.

- **Nutzer anlegen:** Menü (⋯) → „Nutzer verwalten“ → „+ Nutzer anlegen“. Ein sicheres Startpasswort wird vorgeschlagen; gib es weiter. Bei der ersten Anmeldung legt der Nutzer sein eigenes Passwort fest.
- **Passwort vergessen?** Ein Admin vergibt in „Nutzer verwalten“ ein neues Startpasswort. Der Nutzer wird dabei auf allen Geräten abgemeldet.
- **Nutzer löschen** entfernt den Zugang und alle seine Einträge endgültig.
- **Sicherung** enthält immer nur die eigenen Daten und spielt sich nur in das eigene Konto ein.

**Update von 1.x:** Beim ersten Aufruf wird die Datenbank automatisch umgestellt. Alle bisherigen Daten gehören dann dem Admin-Konto mit dem Benutzernamen **admin** und deinem bisherigen Passwort. Den Benutzernamen kannst du in „Nutzer verwalten“ ändern. Vor dem Update eine Sicherung herunterladen!

## Update auf eine neue Version

Alle Dateien überschreiben – **außer `inc/config.php`**. Die Daten in der Datenbank bleiben erhalten.

## Sicherheit

- Passwörter werden nur als Hash gespeichert (`password_hash`), Login wird nach 5 Fehlversuchen zunehmend gebremst. Passwortwechsel oder -zurücksetzung beendet die Sitzungen auf anderen Geräten.
- Jede Datenbankabfrage ist auf den angemeldeten Nutzer begrenzt; Offline-Daten im Browser werden pro Nutzer getrennt und beim Abmelden gelöscht.
- Alle Datenbankzugriffe mit Prepared Statements, CSRF-Schutz für alle Änderungen, strenge Content-Security-Policy.
- `inc/` ist per `.htaccess` gesperrt. Bei nginx-Hostern (ohne .htaccess) ist `config.php` trotzdem nicht lesbar, da sie als PHP ausgeführt wird und nichts ausgibt.
- Schriften und Excel-Bibliothek liegen lokal – es werden keine externen Server angefragt.

## Versionen

- 2.1.0 – Titel manuell anlegen direkt aus „+ Titel“ (auch wenn die DNB nicht erreichbar ist), Einträge duplizieren (nächster Band), Filter „Komplette Reihen ausblenden“ in der Sammlung
- 2.0.1 – Lizenz auf AGPL-3.0-or-later umgestellt, Quellcode-Link in der Fußleiste, Drittanbieter-Lizenzen beigelegt
- 2.0.0 – Mehrere Nutzer mit getrennten Sammlungen, Nutzerverwaltung für Admins, Anmeldung mit Benutzername
- 1.3.1 – Darstellung der Datei-Auswahlbox korrigiert
- 1.3.0 – Sammlung nach Reihen, gelesen-Markierung, Einträge ohne ISBN, Übernahme aus Apple Notes, Offline-Modus, Sicherung/Wiederherstellung, Suche über alles
- 1.2.0 – Titel über die Deutsche Nationalbibliothek suchen und hinzufügen
- 1.1.1 – Zwischenspeicher korrigiert: Updates kommen sofort an
- 1.1.0 – Statistik-Ansicht mit Monatsdiagramm
- 1.0.0 – erste Version

## Lizenz

Copyright (C) 2026 Kai Kranz

Comic-Planer ist freie Software: Du kannst ihn unter den Bedingungen der **GNU Affero General Public License** (Version 3 oder jeder späteren Version) weitergeben und/oder verändern – siehe [`LICENSE`](LICENSE).

Kurz gesagt: Nutzen, verändern und weitergeben ist erlaubt. Wer eine veränderte Fassung für andere betreibt (auch nur als Webdienst), muss deren Quellcode unter derselben Lizenz zugänglich machen. Die App verlinkt dafür in der Fußleiste auf dieses Repository – wer sie verändert, passt `APP_SOURCE_URL` in `inc/lib.php` auf seinen eigenen Quellcode an.

Mitgelieferte Fremdbestandteile (SheetJS, Schriften) stehen unter eigenen, verträglichen Lizenzen – siehe [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). Titeldaten der Deutschen Nationalbibliothek: CC0.
