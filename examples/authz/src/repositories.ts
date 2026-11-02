import type { AccessFilter } from '@hexok/authz';
import { accessStages } from '@hexok/authz-mongo';
import { Adapter, Mapper } from 'hexok';
import { type Collection, type Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import { ExampleError, Location, Note, Scan } from './domain.js';
import { Locations, Notes, Scans } from './ports.js';

const scanRow = z.object({
  _id: z.instanceof(ObjectId),
  code: z.string(),
  locationId: z.string(),
});
type ScanRow = z.infer<typeof scanRow>;

export class MongoScan extends Mapper('mongo.Scan', Scan, scanRow) {
  protected fromSource(scan: Scan): ScanRow {
    const { id, code, locationId } = scan.props;
    return { _id: new ObjectId(id.slice('scan:'.length)), code, locationId };
  }

  protected toSource({ _id, code, locationId }: ScanRow) {
    return { id: `scan:${_id.toHexString()}`, code, locationId };
  }
}

export class MongoScans extends Adapter(Scans) {
  private readonly scans: Collection<ScanRow>;
  private readonly mapper = new MongoScan();

  constructor(deps: { readonly db: Db }) {
    super();
    this.scans = deps.db.collection<ScanRow>('scans');
  }

  override async save(scan: Scan): Promise<void> {
    await this.scans.insertOne(this.mapper.toModel(scan));
    scan.commit();
  }

  override async list(query: { access: AccessFilter }) {
    const rows = await this.scans
      .aggregate<ScanRow>([
        ...accessStages(query.access),
        { $sort: { code: 1 } },
      ])
      .toArray();
    return rows.map((row) => this.mapper.fromModel(row));
  }
}

const noteRow = z.object({
  _id: z.string(),
  parentId: z.string(),
  body: z.string(),
  updatedAt: z.date(),
});
type NoteRow = z.infer<typeof noteRow>;

export class MongoNote extends Mapper('mongo.Note', Note, noteRow) {
  protected fromSource(note: Note): NoteRow {
    const { id, ...props } = note.props;
    return { _id: id, ...props };
  }

  protected toSource({ _id, ...row }: NoteRow) {
    return { id: _id, ...row };
  }
}

export class MongoNotes extends Adapter(Notes) {
  private readonly notes: Collection<NoteRow>;
  private readonly mapper = new MongoNote();

  constructor(deps: { readonly db: Db }) {
    super();
    this.notes = deps.db.collection<NoteRow>('notes');
  }

  override async start(): Promise<void> {
    await this.notes.createIndex({ parentId: 1, updatedAt: -1 });
  }

  override async get(id: string): Promise<Note> {
    const row = await this.notes.findOne({ _id: id });
    if (row === null) throw ExampleError.Missing();
    return this.mapper.fromModel(row as NoteRow);
  }

  override async save(note: Note): Promise<void> {
    const { _id, ...row } = this.mapper.toModel(note);
    await this.notes.replaceOne({ _id }, row, { upsert: true });
    note.commit();
  }

  override async delete(id: string): Promise<void> {
    await this.notes.deleteOne({ _id: id });
  }

  override async list(query: { parentId: string; access: AccessFilter }) {
    const rows = await this.notes
      .aggregate<NoteRow>([
        // Narrow with the repository's own index first.
        { $match: { parentId: query.parentId } },
        ...accessStages(query.access),
        { $sort: { updatedAt: -1 } },
      ])
      .toArray();
    return rows.map((row) => this.mapper.fromModel(row));
  }
}

type LocationRow = { _id: string; regionId: string };

export class MongoLocations extends Adapter(Locations) {
  private readonly locations: Collection<LocationRow>;

  constructor(deps: { readonly db: Db }) {
    super();
    this.locations = deps.db.collection<LocationRow>('locations');
  }

  override async get(id: string): Promise<Location> {
    const row = await this.locations.findOne({ _id: id });
    if (row === null) throw ExampleError.Missing();
    return Location.restore({ id: row._id, regionId: row.regionId });
  }

  override async save(location: Location): Promise<void> {
    const { id, regionId } = location.props;
    await this.locations.replaceOne(
      { _id: id },
      { regionId },
      { upsert: true },
    );
    location.commit();
  }
}
